#include "quant_plugin_host.hpp"
#include "market_history.hpp"
#include "watchlist_backup_model.hpp"
#include <QCryptographicHash>
#include <QDateTime>
#include <QDate>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QProcessEnvironment>
#include <QRegularExpression>
#include <QSaveFile>
#include <QUuid>
#include <cmath>
#include <stdexcept>
#ifdef Q_OS_WIN
#include <windows.h>
#endif

namespace quantPlugin {
void require(bool ok, const QString& message) {
    if (!ok) throw std::runtime_error(message.toUtf8().constData());
}
QString hash(const QByteArray& data) {
    return QString::fromLatin1(QCryptographicHash::hash(data, QCryptographicHash::Sha256).toHex());
}
QByteArray read(const QString& path, qint64 limit) {
    QFile f(path);
    require(!QFileInfo(path).isSymLink() && f.open(QIODevice::ReadOnly) && f.size() <= limit,
            "文件缺失、链接或超过限制：" + path);
    return f.readAll();
}
QJsonObject object(const QByteArray& data) {
    auto text = QString::fromUtf8(data);
    require(text.toUtf8() == data, "JSON 不是有效 UTF-8");
    watchlistBackup::JsonGate{text}.run();
    QJsonParseError error;
    auto doc = QJsonDocument::fromJson(data, &error);
    require(error.error == QJsonParseError::NoError && doc.isObject(), "需要完整 JSON 对象");
    return doc.object();
}
void write(const QString& path, const QByteArray& data) {
    QSaveFile f(path);
    require(f.open(QIODevice::WriteOnly) && f.write(data) == data.size() && f.commit(), "无法完整保存：" + path);
}
void write(const QString& path, const QJsonObject& data) {
    write(path, QJsonDocument(data).toJson(QJsonDocument::Indented));
}
static bool idValid(const QString& id) {
    return QRegularExpression("^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*){2,6}$").match(id).hasMatch();
}
static bool relative(const QString& path) {
    if (path.isEmpty() || path.size() > 200 || path.contains('\\') || path.contains(':') || QDir::isAbsolutePath(path)) return false;
    for (auto part : path.split('/')) {
        if (!QRegularExpression("^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$").match(part).hasMatch() || part.endsWith('.') ||
            QRegularExpression("^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\\..*)?$", QRegularExpression::CaseInsensitiveOption).match(part).hasMatch()) return false;
    }
    return true;
}
QByteArray generatedData(const QJsonObject& artifact) {
    auto name=artifact.value("name").toString();
    require(relative(name)&&!name.contains('/'),"生成文件名称无效");
    auto encoded=artifact.value("base64").toString().toLatin1();
    auto raw=QByteArray::fromBase64(encoded,QByteArray::AbortOnBase64DecodingErrors);
    require(!raw.isEmpty()&&raw.size()<=16*1024*1024&&raw.toBase64()==encoded&&hash(raw)==artifact.value("sha256").toString(),"生成文件内容或摘要无效");
    return raw;
}
QByteArray tableCsv(const QJsonObject& table) {
    auto columns=table.value("columns").toArray();auto rows=table.value("rows").toArray();
    require(!columns.isEmpty()&&columns.size()<=64&&rows.size()<=100000,"导出表结构无效");
    QByteArray result("\xEF\xBB\xBF");
    auto append=[&result](const QJsonArray& row){QStringList values;for(auto cell:row){
        require(cell.isNull()||cell.isBool()||cell.isString()||cell.isDouble(),"导出单元类型无效");
        QString value=cell.isNull()?QString():cell.isDouble()?QString::number(cell.toDouble(),'g',17):cell.isBool()?(cell.toBool()?"true":"false"):cell.toString();
        if(cell.isString()&&!value.isEmpty()&&QString("=+-@\t\r\n").contains(value[0]))value.prepend('\'');
        value.replace('"',"\"\"");values<<"\""+value+"\"";
    }result+=values.join(',').toUtf8()+"\r\n";};
    append(columns);for(auto row:rows){require(row.isArray()&&row.toArray().size()==columns.size(),"导出行长度无效");append(row.toArray());}
    return result;
}
static void plainDirectory(const QString& root, const QString& path) {
    const auto absolute = QDir::cleanPath(QFileInfo(path).absoluteFilePath());
    const auto base = QDir::cleanPath(QFileInfo(root).absoluteFilePath());
    require(absolute == base || absolute.startsWith(base + "/", Qt::CaseInsensitive), "目录越界");
    auto cursor = absolute;
    while (cursor.size() >= base.size()) {
        require(!QFileInfo(cursor).isSymLink(), "插件目录不能使用链接");
        if (cursor == base) break;
        cursor = QFileInfo(cursor).absolutePath();
    }
}
QJsonObject validateManifest(const QJsonObject& m) {
    require(m.value("schema") == "webstock.plugin.manifest.v1" && m.value("protocolVersion") == 1 &&
            m.value("runtime") == "python", "不支持的插件协议或运行环境");
    require(idValid(m.value("id").toString()) && QRegularExpression("^[0-9]+\\.[0-9]+\\.[0-9]+$").match(m.value("version").toString()).hasMatch(), "插件身份无效");
    require(!m.value("name").toString().isEmpty() && !m.value("license").toString().isEmpty(), "插件缺少名称或许可声明");
    const auto files = m.value("files").toObject();
    require(!files.isEmpty() && files.size() <= 256 && files.contains(m.value("entrypoint").toString()), "插件文件清单无效");
    QSet<QString> names;
    for (auto i = files.begin(); i != files.end(); ++i) {
        require(relative(i.key()) && !names.contains(i.key().toLower()) && i.key().toLower() != "manifest.json" &&
                QRegularExpression("^[0-9a-f]{64}$").match(i.value().toString()).hasMatch(), "插件文件路径或摘要无效");
        names.insert(i.key().toLower());
    }
    auto operations = m.value("operations").toArray();
    require(!operations.isEmpty() && operations.size() <= 512, "插件需要1–512项功能");
    names.clear();
    for (auto value : operations) {
        auto op = value.toObject(); auto id = op.value("id").toString();
        require(QRegularExpression("^[a-z][a-z0-9_-]{0,80}$").match(id).hasMatch() && !names.contains(id), "重复或无效功能身份");
        names.insert(id);
        require(!op.value("title").toString().isEmpty() && !op.value("formulaVersion").toString().isEmpty() &&
                QStringList{"ohlcv-single-csv","market-panel-csv","market-events-csv","portfolio-equity-csv","research-observations-csv","option-chain-csv","parameters-only"}.contains(op.value("inputKind").toString()) && QStringList{"indicator","backtest","data"}.contains(op.value("outputKind").toString()) &&
                op.value("parameters").isArray() && op.value("parameters").toArray().size() <= 32, "功能定义不完整");
        QSet<QString> fields;
        for (auto p : op.value("parameters").toArray()) {
            auto field = p.toObject(); auto key = field.value("id").toString();
            require(QRegularExpression("^[a-zA-Z][a-zA-Z0-9_]{0,60}$").match(key).hasMatch() && !fields.contains(key), "参数身份重复或无效");
            fields.insert(key);
            auto type = field.value("type").toString();
            require(QStringList{"integer","number","choice","text"}.contains(type), "不支持的参数类型");
            if (type == "choice") require(!field.value("choices").toArray().isEmpty(), "选项缺失");
            else if(type == "text") require(field.value("minLength").isDouble() && field.value("maxLength").isDouble() &&
                field.value("minLength").toInt()>=0 && field.value("maxLength").toInt()>=field.value("minLength").toInt() &&
                field.value("maxLength").toInt()<=512 && QStringList{"text","date","cn-stock"}.contains(field.value("format").toString()),"文本参数范围无效");
            else require(field.value("minimum").isDouble() && field.value("maximum").isDouble() &&
                         field.value("minimum").toDouble() <= field.value("maximum").toDouble(), "参数范围无效");
        }
        validateParameters(op, {});
    }
    return m;
}
QJsonObject validateParameters(const QJsonObject& operation, const QJsonObject& parameters) {
    QJsonObject result; QSet<QString> keys;
    for (auto value : operation.value("parameters").toArray()) {
        auto field = value.toObject(); auto key = field.value("id").toString(); keys.insert(key);
        auto v = parameters.contains(key) ? parameters.value(key) : field.value("default");
        if (field.value("type") == "choice") require(field.value("choices").toArray().contains(v), "参数选项无效：" + key);
        else if(field.value("type") == "text") {
            auto s=v.toString();auto format=field.value("format").toString();
            require(v.isString()&&s.size()>=field.value("minLength").toInt()&&s.size()<=field.value("maxLength").toInt()&&
                !QRegularExpression("[\\x00-\\x1f\\x7f]").match(s).hasMatch(),"文本参数无效："+key);
            if(format=="cn-stock")require(QRegularExpression("^[0-9]{6}$").match(s).hasMatch(),"需要六位股票代码："+key);
            if(format=="date")require(QRegularExpression("^[0-9]{4}-[0-9]{2}-[0-9]{2}$").match(s).hasMatch()&&QDate::fromString(s,Qt::ISODate).isValid(),"需要有效日期 YYYY-MM-DD："+key);
        }
        else {
            auto n = v.toDouble();
            require(v.isDouble() && std::isfinite(n) && n >= field.value("minimum").toDouble() && n <= field.value("maximum").toDouble() &&
                    (field.value("type") != "integer" || std::floor(n) == n), "参数值或范围无效：" + key);
        }
        result[key] = v;
    }
    for (auto key : parameters.keys()) require(keys.contains(key), "未知参数：" + key);
    return result;
}
Repository::Repository(QString root) : root_(QDir::cleanPath(QFileInfo(root).absoluteFilePath())) {
    require(!QFileInfo(root_).isSymLink() && QDir().mkpath(root_ + "/packages") && QDir().mkpath(root_ + "/jobs"), "插件目录不可用");
}
QJsonArray Repository::plugins() const {
    if (!QFileInfo::exists(root_ + "/catalog.json")) return {};
    auto catalog = object(read(root_ + "/catalog.json", 2*1024*1024));
    require(catalog.value("schema") == "webstock.plugin.catalog.v1", "插件目录清单损坏");
    return catalog.value("plugins").toArray();
}
QString Repository::directory(const QJsonObject& p) const {
    require(idValid(p.value("id").toString()) && QRegularExpression("^[0-9]+\\.[0-9]+\\.[0-9]+$").match(p.value("version").toString()).hasMatch(), "插件目录身份无效");
    auto dir = root_ + "/packages/" + p.value("id").toString() + "/" + p.value("version").toString();
    plainDirectory(root_, dir); return dir;
}
QJsonObject Repository::plugin(const QString& id) const {
    for (auto v : plugins()) if (v.toObject().value("id") == id) {
        auto p = v.toObject(); auto bytes = read(directory(p) + "/manifest.json", 2*1024*1024);
        require(hash(bytes) == p.value("manifestSha256").toString(), "已安装插件清单被修改");
        p["manifest"] = validateManifest(object(bytes)); return p;
    }
    throw std::runtime_error("插件未安装");
}
QJsonObject Repository::install(const QByteArray& package) {
    require(package.size() <= 32*1024*1024, "插件包超过32 MiB");
    auto bundle = object(package);
    require(bundle.value("schema") == "webstock.plugin.package.v1", "不是WebStock插件包");
    auto m = validateManifest(bundle.value("manifest").toObject());
    auto files = bundle.value("files").toObject(); auto hashes = m.value("files").toObject();
    require(files.keys() == hashes.keys(), "插件文件清单不一致");
    QMap<QString,QByteArray> decoded; qint64 total = 0;
    for (auto i = files.begin(); i != files.end(); ++i) {
        auto encoded = i.value().toString().toLatin1();
        auto raw = QByteArray::fromBase64(encoded, QByteArray::AbortOnBase64DecodingErrors);
        total += raw.size();
        require(raw.toBase64() == encoded && raw.size() <= 4*1024*1024 && total <= 24*1024*1024 && hash(raw) == hashes.value(i.key()).toString(), "插件文件摘要或大小不匹配");
        decoded[i.key()] = raw;
    }
    QLockFile lock(root_ + "/catalog.lock"); require(lock.tryLock(0), "另一窗口正在更新插件");
    auto list = plugins(); QJsonObject previous;
    for (auto v : list) if (v.toObject().value("id") == m.value("id")) previous = v.toObject();
    if(previous.isEmpty() && QFileInfo::exists(root_+"/preferences.json"))
        previous=object(read(root_+"/preferences.json",2*1024*1024)).value(m.value("id").toString()).toObject();
    if(!QFileInfo(previous.value("runtimePath").toString()).isFile())
        previous["runtimePath"]=runtimeFor(m.value("id").toString());
    const auto bytes = QJsonDocument(m).toJson(QJsonDocument::Indented);
    QJsonObject entry{{"id",m.value("id")},{"version",m.value("version")},{"name",m.value("name")},
                      {"manifestSha256",hash(bytes)},{"enabled",true},{"runtimePath",previous.value("runtimePath").toString()},
                      {"parametersByOperation",previous.value("parametersByOperation").toObject()}};
    auto destination = directory(entry);
    if (QFileInfo::exists(destination)) {
        require(read(destination + "/manifest.json") == bytes, "同版本内容不同，请使用新版本号");
        for (auto i = decoded.begin(); i != decoded.end(); ++i) require(read(destination + "/" + i.key()) == i.value(), "原安装内容已变化，未覆盖");
    } else {
        auto staging = root_ + "/packages/.install-" + QUuid::createUuid().toString(QUuid::WithoutBraces);
        require(QDir().mkpath(staging), "无法准备插件目录");
        for (auto i = decoded.begin(); i != decoded.end(); ++i) {
            require(QDir().mkpath(QFileInfo(staging + "/" + i.key()).absolutePath()), "无法创建插件子目录");
            write(staging + "/" + i.key(), i.value());
        }
        write(staging + "/manifest.json", bytes);
        require(QDir().mkpath(QFileInfo(destination).absolutePath()) && QDir().rename(staging, destination), "无法完成插件安装；原版本保留");
    }
    QJsonArray next;
    for (auto v : list) if (v.toObject().value("id") != m.value("id")) next.append(v);
    next.append(entry);
    write(root_ + "/catalog.json", QJsonObject{{"schema","webstock.plugin.catalog.v1"},{"plugins",next}});
    return entry;
}
QString Repository::runtimeFor(const QString& id) const {
    auto valid=[](const QString& path){return QFileInfo(path).isAbsolute()&&QFileInfo(path).isFile();};
    for(auto v:plugins())if(v.toObject().value("id")==id){auto path=v.toObject().value("runtimePath").toString();if(valid(path))return path;}
    // Only exact plugin-ID mappings from this installation are reused. Never
    // execute a guessed interpreter or a runtime path supplied by a package.
    if(QFileInfo::exists(root_+"/preferences.json")){
        auto path=object(read(root_+"/preferences.json",2*1024*1024)).value(id).toObject().value("runtimePath").toString();
        if(valid(path))return path;
    }
    if(QFileInfo::exists(root_+"/runtime-defaults.json")){
        auto path=object(read(root_+"/runtime-defaults.json",2*1024*1024)).value(id).toString();
        if(valid(path))return path;
    }
    return {};
}
void Repository::configure(const QString& id, const QString& runtime, bool enabled) {
    auto selected = plugin(id);
    require(runtime.isEmpty() || (QFileInfo(runtime).isAbsolute() && QFileInfo(runtime).isFile()), "请选择有效的解释器文件");
    QLockFile lock(root_ + "/catalog.lock"); require(lock.tryLock(0), "插件配置正在更新");
    QJsonArray next;
    for (auto v : plugins()) {auto p=v.toObject(); if (p.value("id") == id) {p["runtimePath"]=runtime;p["enabled"]=enabled;} next.append(p);}
    write(root_ + "/catalog.json", QJsonObject{{"schema","webstock.plugin.catalog.v1"},{"plugins",next}});
}
void Repository::uninstall(const QString& id) {
    auto selected=plugin(id);selected.remove("manifest");
    QLockFile lock(root_+"/catalog.lock");require(lock.tryLock(0),"插件目录正在更新");
    QJsonObject preferences;
    if(QFileInfo::exists(root_+"/preferences.json"))preferences=object(read(root_+"/preferences.json",2*1024*1024));
    preferences[id]=selected;write(root_+"/preferences.json",preferences);
    QJsonArray next;for(auto p:plugins())if(p.toObject().value("id")!=id)next.append(p);
    // Version cache is retained for rollback; removed plugins cannot start jobs.
    write(root_+"/catalog.json",QJsonObject{{"schema","webstock.plugin.catalog.v1"},{"plugins",next}});
}
void Repository::rememberParameters(const QString& id,const QString& operationId,const QJsonObject& parameters){
    auto selected=plugin(id);QJsonObject operation;
    for(auto op:selected.value("manifest").toObject().value("operations").toArray())if(op.toObject().value("id")==operationId)operation=op.toObject();
    require(!operation.isEmpty(),"功能身份无效");auto checked=validateParameters(operation,parameters);
    QLockFile lock(root_+"/catalog.lock");require(lock.tryLock(0),"插件配置正在更新");QJsonArray next;
    for(auto v:plugins()){auto p=v.toObject();if(p.value("id")==id){auto saved=p.value("parametersByOperation").toObject();saved[operationId]=checked;p["parametersByOperation"]=saved;}next.append(p);}
    write(root_+"/catalog.json",QJsonObject{{"schema","webstock.plugin.catalog.v1"},{"plugins",next}});
}
static bool runIdValid(const QString& id) {
    return QRegularExpression("^plugin-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$").match(id).hasMatch();
}
Job::Job(QString root, QObject* parent) : QObject(parent), repository_(root) {
    timeout_.setSingleShot(true);
    connect(&timeout_, &QTimer::timeout, this, [this]{stop("timed_out");});
    connect(&process_, &QProcess::readyReadStandardOutput, this, [this]{drain();});
    connect(&process_, &QProcess::readyReadStandardError, this, [this]{
        stderr_ += process_.readAllStandardError(); if (stderr_.size()>1024*1024) stderr_=stderr_.right(1024*1024);
    });
    connect(&process_, &QProcess::finished, this, &Job::finish);
    connect(&process_, &QProcess::errorOccurred, this, [this](QProcess::ProcessError error){
        if (error == QProcess::FailedToStart) finish(-1,QProcess::CrashExit);
    });
    connect(&process_, &QProcess::started, this, [this]{
#ifdef Q_OS_WIN
        auto group=CreateJobObjectW(nullptr,nullptr);
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
        limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        auto handle=OpenProcess(PROCESS_SET_QUOTA|PROCESS_TERMINATE, FALSE, DWORD(process_.processId()));
        bool ok=group && SetInformationJobObject(group,JobObjectExtendedLimitInformation,&limits,sizeof(limits)) && handle && AssignProcessToJobObject(group,handle);
        if(handle) CloseHandle(handle);
        if(!ok) {if(group) CloseHandle(group);stop("process_isolation_failed");return;}
        processGroup_=group;
#endif
        try {record_["status"]="running";save();if(changed) changed();}
        catch(const std::exception& e) {record_["message"]=QString::fromUtf8(e.what());stop("storage_failed");}
    });
    // Recover abandoned records only after obtaining their per-run lifetime lock.
    for (auto name : QDir(repository_.root()+"/jobs").entryList(QDir::Dirs|QDir::NoDotAndDotDot)) {
        if(!runIdValid(name)) continue;
        auto dir=repository_.root()+"/jobs/"+name; QLockFile abandoned(dir+"/run.lock");
        if(!abandoned.tryLock(0)) continue;
        try {auto r=object(read(dir+"/record.json")); if(QStringList{"starting","running"}.contains(r.value("status").toString())) {
            r["status"]="interrupted";r["message"]="上次进程未完成，未自动重跑";write(dir+"/record.json",r);
        }} catch(const std::exception&) { /* Keep damaged records for diagnosis. */ }
    }
}
Job::~Job() {
    changed={}; progress={}; cancel();
    if(process_.state()!=QProcess::NotRunning) {process_.kill();process_.waitForFinished(3000);}
#ifdef Q_OS_WIN
    if(processGroup_) CloseHandle(HANDLE(processGroup_));
#endif
}
void Job::save() {write(folder_+"/record.json",record_);}
static QJsonObject marketSummary(const QJsonObject& result) {
    const auto p=result.value("parameters").toObject(),source=result.value("provenance").toObject();
    return {{"symbol",p.value("symbol")},{"adjustment",p.value("adjustment")},
        {"requestedStart",source.value("requestedStart")},{"requestedEnd",source.value("requestedEnd")},
        {"firstDate",source.value("firstReturnedDate")},{"lastDate",source.value("lastReturnedDate")},
        {"bars",result.value("bars")},{"source","AKShare / 东方财富"},
        {"acquiredAtUtc",source.value("acquiredAtUtc")},{"pointInTimeDataset",false}};
}
QJsonArray Job::records() const {
    QJsonArray results;
    auto jobs=repository_.root()+"/jobs";
    for(auto name:QDir(jobs).entryList(QDir::Dirs|QDir::NoDotAndDotDot,QDir::Time)) {
        if(!runIdValid(name)) continue;
        try {auto r=object(read(jobs+"/"+name+"/record.json"));require(r.value("runId")==name,"任务身份损坏");
            // Fill display metadata for older archives without migrating or
            // changing any of their frozen files. Reopening verifies results.
            try {
                auto request=object(read(jobs+"/"+name+"/request.json"));
                if(hash(read(jobs+"/"+name+"/request.json"))==r.value("requestSha256").toString())r["parameters"]=request.value("parameters");
                auto manifest=object(read(jobs+"/"+name+"/plugin/manifest.json",2*1024*1024));
                r["pluginName"]=manifest.value("name");
                for(auto op:manifest.value("operations").toArray())if(op.toObject().value("id")==r.value("operationId"))r["operationTitle"]=op.toObject().value("title");
                if(r.value("status")=="completed"&&r.value("pluginId")=="org.webstock.akshare")
                    r["dataSummary"]=marketSummary(object(read(jobs+"/"+name+"/result.json",24*1024*1024)));
            }catch(const std::exception&){/* The archive remains visible for diagnosis. */}
            results.append(r);}
        catch(const std::exception& e) {results.append(QJsonObject{{"runId",name},{"status","damaged"},{"message",QString::fromUtf8(e.what())}});}
    }
    return results;
}
QJsonArray Job::savedMarketData() const {
    QJsonArray saved;
    QSet<QString> sharedOrigins;
    MarketStore store(QFileInfo(repository_.root()).absolutePath()+"/live/market-v1.sqlite");
    QStringList keys;try{keys=store.keys("");}catch(const std::exception&){/* Archive inputs remain available. */}
    QSet<QString> identities;
    // Canonical identities first; old native keys are read through the same
    // conservative compatibility view, never a second cache directory.
    std::stable_sort(keys.begin(),keys.end(),[](const QString& a,const QString& b){return a.startsWith("history/")&&!b.startsWith("history/");});
    for(auto key:keys)try{
        auto snapshot=store.read(key),q=snapshot["historyIdentity"].toObject();auto rows=snapshot["rows"].toArray();if(rows.isEmpty())continue;
        if(q.isEmpty()){
            auto match=QRegularExpression("^(sh|sz|bj)([0-9]{6})-(day|week|month)$").match(key);if(!match.hasMatch())continue;
            auto market=match.captured(1).toUpper(),code=match.captured(2);QString type=market=="SH"&&code.startsWith("000")||market=="SZ"&&code.startsWith("399")||market=="BJ"&&code.startsWith("899")?"index":market=="SH"&&code.startsWith('5')||market=="SZ"&&code.startsWith('1')?"etf":"stock";
            q={{"securityId",market+":"+type+":"+code},{"period",match.captured(3)},{"sourceId","tencent-kline"},{"adjustment",snapshot["adjustment"]=="qfq"?"forward":"unadjusted"}};
        }
        QJsonArray closed;for(auto row:rows)if(row.toObject()["closed"]==true)closed.append(row);if(closed.isEmpty())continue;
        q["startDate"]=closed.first().toObject()["label"];q["endDate"]=closed.last().toObject()["label"];
        if(identities.contains(marketHistory::key(q)))continue;
        auto plan=marketHistory::inspect(store,q);if(!plan["compatible"].toBool())continue;snapshot=plan["snapshot"].toObject();identities.insert(marketHistory::key(q));
        auto summary=marketHistory::summary(snapshot,q);summary["runId"]=marketHistory::token(snapshot,q);summary["shared"]=true;saved.append(summary);sharedOrigins.insert(snapshot["archiveRunId"].toString());
    }catch(const std::exception&){/* Invalid/legacy snapshots are not advertised as verified research inputs. */}
    for(auto v:records()){
        auto r=v.toObject();
        if(r.value("status")!="completed"||r.value("pluginId")!="org.webstock.akshare"||r.value("operationId")!="daily-eastmoney")continue;
        if(sharedOrigins.contains(r["runId"].toString()))continue;
        auto summary=r.value("dataSummary").toObject();
        summary["runId"]=r.value("runId");saved.append(summary);
    }
    return saved;
}
void Job::reuseArchivedMarketData() const {
    auto directory=QFileInfo(repository_.root()).absolutePath()+"/live";require(QDir().mkpath(directory),"公共行情目录不可用");MarketStore store(directory+"/market-v1.sqlite");
    for(auto v:records())try{
        auto record=v.toObject();if(record["status"]!="completed"||record["pluginId"]!="org.webstock.akshare"||record["operationId"]!="daily-eastmoney")continue;
        auto p=record["parameters"].toObject();auto code=p["symbol"].toString();QString market=code.startsWith('6')?"SH":code.startsWith('4')||code.startsWith('8')||code.startsWith("92")?"BJ":"SZ";
        QJsonObject q{{"securityId",market+":stock:"+code},{"period","day"},{"adjustment",p["adjustment"]},{"sourceId","akshare-eastmoney"},{"startDate",p["startDate"]},{"endDate",p["endDate"]}};
        if(!store.read(marketHistory::key(q)).isEmpty())continue;
        auto result=reopen(record["runId"].toString())["result"].toObject();auto snapshot=marketHistory::fromAkshare(result,q);snapshot["importedFromVerifiedPluginArchive"]=record["runId"];store.save(marketHistory::key(q),snapshot);
    }catch(const std::exception&){/* An archive with incomplete identity stays in the archive viewer, never as verified cache. */}
}
QJsonObject Job::marketDataInput(const QString& id) const {
    if(id.startsWith("shared:")){
        auto q=marketHistory::tokenQuery(id);MarketStore store(QFileInfo(repository_.root()).absolutePath()+"/live/market-v1.sqlite");auto plan=marketHistory::inspect(store,q);require(plan["compatible"].toBool(),"公共行情已失效或口径不符，请重新选择");auto snapshot=plan["snapshot"].toObject();
        marketHistory::validate(snapshot,q);require(marketHistory::digest(snapshot)==q["version"].toString(),"公共行情版本已更新，请重新选择并检查数据后再运行");
        auto bytes=marketHistory::csv(snapshot,q);auto directory=repository_.root()+"/data-inputs";plainDirectory(repository_.root(),directory);require(QDir().mkpath(directory),"无法准备研究冻结输入");auto path=directory+"/"+hash(bytes)+".csv";
        if(QFileInfo::exists(path))require(read(path,16*1024*1024)==bytes,"研究输入暂存文件已变化");else write(path,bytes);
        auto summary=marketHistory::summary(snapshot,q);QJsonObject parameters{{"symbol",summary["symbol"]},{"startDate",q["startDate"]},{"endDate",q["endDate"]},{"adjustment",q["adjustment"]}};
        QJsonObject result{{"schema","webstock.shared-market-view.v1"},{"parameters",parameters},{"bars",summary["bars"]},{"tables",QJsonArray{marketHistory::table(snapshot,q)}},
            {"generatedData",QJsonObject{{"name",summary["symbol"].toString()+"-"+q["period"].toString()+".csv"},{"sha256",hash(bytes)},{"base64",QString::fromLatin1(bytes.toBase64())}}},
            {"provenance",QJsonObject{{"providerLabel",summary["source"]},{"requestedStart",q["startDate"]},{"requestedEnd",q["endDate"]},{"firstReturnedDate",summary["firstDate"]},{"lastReturnedDate",summary["lastDate"]},{"acquiredAtUtc",summary["acquiredAtUtc"]},{"sharedStoreVersion",summary["version"]},{"identity",marketHistory::identity(q)},{"queryCoverage",snapshot["queryCoverage"]},{"pointInTimeDataset",false}}}};
        return {{"path",path},{"summary",summary},{"result",result},{"policy",QJsonObject{{"closedBarsOnly",true},{"adjustment",summary["adjustment"]},{"timezone","Asia/Shanghai"},{"volumeUnit","share"},{"source",summary["sourceId"]},{"sharedMarketVersion",summary["version"]},{"dataset",summary},{"queryCoverage",snapshot["queryCoverage"]},{"sourceRequests",snapshot["sourceRequests"]},{"legacyIdentityEvidence",snapshot["legacyIdentityEvidence"]}}}};
    }
    auto record=reopen(id);auto result=record.value("result").toObject();
    require(record.value("status")=="completed"&&result.value("pluginId")=="org.webstock.akshare"&&result.value("operationId")=="daily-eastmoney",
            "所选档案不是已完成的股票历史行情");
    auto bytes=generatedData(result.value("generatedData").toObject());
    // Materialize the already verified result artifact. The original query,
    // result and plugin snapshots remain the sole source of provenance.
    auto directory=repository_.root()+"/data-inputs";plainDirectory(repository_.root(),directory);
    require(QDir().mkpath(directory),"无法准备已保存行情");
    auto path=directory+"/"+hash(bytes)+".csv";
    if(QFileInfo::exists(path))require(hash(read(path,16*1024*1024))==hash(bytes),"已保存行情文件被修改，请保留现场并重新导出原始档案");
    else write(path,bytes);
    auto summary=marketSummary(result);
    return {{"path",path},{"summary",summary},{"policy",QJsonObject{{"closedBarsOnly",true},
        {"adjustment",summary.value("adjustment")},{"timezone","Asia/Shanghai"},{"volumeUnit","share"},
        {"source","AKShare/stock_zh_a_hist/Eastmoney"},{"archiveRunId",id},{"dataset",summary}}}};
}
void Job::start(const QString& pluginId,const QString& operationId,const QString& inputCsv,const QJsonObject& parameters,const QJsonObject& policy,int seconds) {
    require(!active(),"已有插件任务运行"); require(seconds>=1 && seconds<=3600,"运行时限无效");
    auto p=repository_.plugin(pluginId); require(p.value("enabled")==true,"插件已停用");
    auto runtime=p.value("runtimePath").toString();require(QFileInfo(runtime).isAbsolute()&&QFileInfo(runtime).isFile(),"请先配置此插件的运行环境");
    auto m=p.value("manifest").toObject();QJsonObject op;
    for(auto v:m.value("operations").toArray()) if(v.toObject().value("id")==operationId) op=v.toObject();
    require(!op.isEmpty(),"插件没有此功能"); auto args=validateParameters(op,parameters);
    const bool query=op.value("inputKind")=="parameters-only";
    const bool panel=op.value("inputKind")=="market-panel-csv";
    const bool events=op.value("inputKind")=="market-events-csv";
    const bool portfolio=op.value("inputKind")=="portfolio-equity-csv";
    const bool observations=op.value("inputKind")=="research-observations-csv";
    const bool options=op.value("inputKind")=="option-chain-csv";
    if(options)require(policy.value("knownQuotesOnly")==true,"请确认期权报价、标的价格及曲线输入在各快照时点已经可知");
    else if(observations)require(policy.value("knownObservationsOnly")==true,"请确认数据发布及修订在各记录时点已经可知");
    else if(portfolio)require(policy.value("knownValuationsOnly")==true,"请确认权益、费用与出入金为当时可知的估值记录");
    else if(events)require(policy.value("knownEventsOnly")==true,"请确认输入为已发生且当时可知的成交或盘口事件");
    else if(!query)require(policy.value("closedBarsOnly")==true && (panel||QStringList{"unknown","unadjusted","forward","backward"}.contains(policy.value("adjustment").toString())),"请明确已完成K线及价格口径");
    auto input=query?QJsonDocument(QJsonObject{{"schema","webstock.plugin.query.v1"},{"operationId",operationId},{"parameters",args}}).toJson():read(inputCsv,16*1024*1024);
    require(!input.isEmpty(),"输入为空");const QString inputFile=query?"input.json":"input.csv";
    repository_.rememberParameters(pluginId,operationId,args);
    auto id="plugin-"+QUuid::createUuid().toString(QUuid::WithoutBraces);
    folder_=repository_.root()+"/jobs/"+id;plainDirectory(repository_.root(),folder_);
    require(QDir().mkpath(folder_+"/plugin"),"任务目录不可写");
    auto lock=std::make_unique<QLockFile>(folder_+"/run.lock");require(lock->tryLock(0),"任务已由另一进程持有");
    auto files=m.value("files").toObject();
    for(auto i=files.begin();i!=files.end();++i) {
        auto original=repository_.directory(p)+"/"+i.key();plainDirectory(repository_.directory(p),QFileInfo(original).absolutePath());
        auto bytes=read(original,4*1024*1024);require(hash(bytes)==i.value().toString(),"插件源文件已变化");
        QDir().mkpath(QFileInfo(folder_+"/plugin/"+i.key()).absolutePath());write(folder_+"/plugin/"+i.key(),bytes);
    }
    auto manifest=read(repository_.directory(p)+"/manifest.json");write(folder_+"/plugin/manifest.json",manifest);
    write(folder_+"/"+inputFile,input);
    auto frozen=query?QJsonObject{{"kind","parameters-only"},{"source","explicit parameter query"}}:policy;
    if(panel){frozen["kind"]="market-panel-csv";frozen["adjustment"]="declared-in-input";frozen["timezone"]="explicit-offset-per-row";frozen["volumeUnit"]="share";}
    if(events){frozen.remove("closedBarsOnly");frozen["kind"]="market-events-csv";frozen["adjustment"]="raw";frozen["timezone"]="explicit-offset-per-row";frozen["volumeUnit"]="share";}
    if(portfolio){frozen.remove("closedBarsOnly");frozen.remove("knownEventsOnly");frozen.remove("adjustment");frozen.remove("volumeUnit");frozen["kind"]="portfolio-equity-csv";frozen["timezone"]="explicit-offset-per-row";frozen["currency"]="declared-in-input";}
    else frozen.remove("knownValuationsOnly");
    if(observations){frozen.remove("closedBarsOnly");frozen.remove("knownEventsOnly");frozen.remove("adjustment");frozen.remove("volumeUnit");frozen["kind"]="research-observations-csv";frozen["timezone"]="explicit-offset-per-row";frozen["unit"]="declared-per-series";}
    else frozen.remove("knownObservationsOnly");
    if(options){frozen.remove("closedBarsOnly");frozen.remove("knownEventsOnly");frozen.remove("adjustment");frozen["kind"]="option-chain-csv";frozen["timezone"]="explicit-offset-per-row";frozen["volumeUnit"]="contract";frozen["priceUnit"]="per-underlying-unit";}
    else frozen.remove("knownQuotesOnly");
    frozen["path"]=inputFile;frozen["sha256"]=hash(input);frozen["originalName"]=query?"query.json":QFileInfo(inputCsv).fileName();
    QJsonObject request{{"schema","webstock.plugin.request.v1"},{"runId",id},{"pluginId",pluginId},{"operationId",operationId},
                        {"manifestSha256",hash(manifest)},{"input",frozen},{"parameters",args},{"automaticTrading",false}};
    write(folder_+"/request.json",request);
    record_={{"runId",id},{"pluginId",pluginId},{"operationId",operationId},{"status","starting"},
             {"createdAt",QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},
             {"requestSha256",hash(read(folder_+"/request.json"))},{"runtimePath",runtime}};
    save();lock_=std::move(lock);stdout_.clear();stderr_.clear();stopped_.clear();finishing_=false;
    auto env=QProcessEnvironment::systemEnvironment();env.remove("PYTHONPATH");env.remove("PYTHONHOME");
    env.insert("PYTHONUTF8","1");env.insert("PYTHONDONTWRITEBYTECODE","1");env.insert("OMP_NUM_THREADS","1");env.insert("OPENBLAS_NUM_THREADS","1");
    process_.setProcessEnvironment(env);process_.setWorkingDirectory(folder_);process_.setProgram(runtime);
    process_.setArguments({"-u",folder_+"/plugin/"+m.value("entrypoint").toString(),folder_+"/request.json"});
#ifdef Q_OS_WIN
    process_.setCreateProcessArgumentsModifier([](QProcess::CreateProcessArguments* a){a->flags|=CREATE_NO_WINDOW;});
#endif
    timeout_.start(seconds*1000);process_.start();if(changed) changed();
}
void Job::drain() {
    stdout_+=process_.readAllStandardOutput();
    if(stdout_.size()>1024*1024) {stop("output_limit");return;}
    int end;
    while((end=stdout_.indexOf('\n'))>=0) {
        auto line=stdout_.left(end).trimmed();stdout_.remove(0,end+1);
        // Engine-native log lines may coexist with protocol progress.
        if(!line.startsWith('{')) continue;
        try {auto event=object(line);if(event.value("event")=="progress" && progress) progress(event.value("message").toString());
            if(event.value("event")=="error") record_["message"]=event.value("message");
        } catch(const std::exception&) { /* Native engine logs are not result evidence. */ }
    }
}
static QString frozenInputName(const QJsonObject& request) {
    auto path=request.value("input").toObject().value("path").toString();
    require(QStringList{"input.csv","input.json"}.contains(path),"冻结输入文件名无效");return path;
}
QJsonObject Job::verify(const QString& directory,const QJsonObject& record) const {
    auto requestBytes=read(directory+"/request.json");require(hash(requestBytes)==record.value("requestSha256").toString(),"冻结请求已变化");
    auto request=object(requestBytes);auto manifestBytes=read(directory+"/plugin/manifest.json");
    require(hash(manifestBytes)==request.value("manifestSha256").toString(),"冻结插件清单已变化");
    auto m=validateManifest(object(manifestBytes));auto files=m.value("files").toObject();
    for(auto i=files.begin();i!=files.end();++i) require(hash(read(directory+"/plugin/"+i.key()))==i.value().toString(),"冻结代码已变化");
    const auto inputFile=frozenInputName(request);const auto inputBytes=read(directory+"/"+inputFile,16*1024*1024);
    require(hash(inputBytes)==request.value("input").toObject().value("sha256").toString(),"冻结数据已变化");
    auto resultBytes=read(directory+"/result.json",24*1024*1024);
    if(record.contains("resultSha256")) require(hash(resultBytes)==record.value("resultSha256").toString(),"结果摘要已变化");
    auto result=object(resultBytes);
    require(result.value("schema")=="webstock.plugin.result.v1" && result.value("status")=="completed" && result.value("automaticTrading")==false,"结果协议或状态无效");
    require(request.value("runId")==record.value("runId") && result.value("runId")==request.value("runId") &&
            result.value("pluginId")==request.value("pluginId") && result.value("pluginId")==m.value("id") && result.value("pluginVersion")==m.value("version") &&
            result.value("operationId")==request.value("operationId") && result.value("requestSha256")==hash(requestBytes) &&
            result.value("manifestSha256")==request.value("manifestSha256") && result.value("inputSha256")==request.value("input").toObject().value("sha256") &&
            result.value("parameters")==request.value("parameters") && result.value("dataPolicy")==request.value("input"),"结果和任务不匹配");
    QJsonObject op;for(auto v:m.value("operations").toArray()) if(v.toObject().value("id")==request.value("operationId")) op=v.toObject();
    require((op.value("inputKind")=="parameters-only"?"input.json":"input.csv")==inputFile,"输入类型不匹配");
    require(validateParameters(op,request.value("parameters").toObject())==request.value("parameters").toObject(),"冻结参数不完整");
    if(inputFile=="input.json")require(object(inputBytes)==QJsonObject{{"schema","webstock.plugin.query.v1"},{"operationId",request.value("operationId")},{"parameters",request.value("parameters")}},"冻结查询与请求不匹配");
    require(!op.isEmpty() && result.value("kind")==op.value("outputKind") && !result.value("engineVersion").toString().isEmpty() &&
            !result.value("formulaVersion").toString().isEmpty() && result.value("warnings").isArray(),"结果能力或版本缺失");
    // Early 0.1/0.2 packages recorded TA-Lib's kernel version in this field.
    if(m.value("version").toString()!="0.1.0"&&m.value("version").toString()!="0.2.0")
        require(result.value("formulaVersion")==op.value("formulaVersion"),"结果公式版本不匹配");
    auto tables=result.value("tables").toArray();require(!tables.isEmpty()&&tables.size()<=32,"结果表缺失或超限");QSet<QString> names;
    for(auto value:tables) {
        auto table=value.toObject();auto name=table.value("id").toString();auto columns=table.value("columns").toArray();auto rows=table.value("rows").toArray();
        require(!name.isEmpty()&&!names.contains(name)&&!columns.isEmpty()&&columns.size()<=64&&rows.size()<=100000,"结果表结构无效");names.insert(name);
        QSet<QString> columnNames;for(auto c:columns) {require(c.isString()&&!c.toString().isEmpty()&&!columnNames.contains(c.toString()),"重复或无效列");columnNames.insert(c.toString());}
        for(auto row:rows) {require(row.isArray()&&row.toArray().size()==columns.size(),"结果行长度无效");for(auto cell:row.toArray())
            require(cell.isNull()||cell.isString()||cell.isBool()||(cell.isDouble()&&std::isfinite(cell.toDouble())),"结果单元无效");}
    }
    if(result.contains("generatedData"))generatedData(result.value("generatedData").toObject());
    return result;
}
void Job::finish(int exitCode,QProcess::ExitStatus status) {
    if(!active()||finishing_) return;finishing_=true;timeout_.stop();
    drain();stderr_+=process_.readAllStandardError();
#ifdef Q_OS_WIN
    if(processGroup_) {CloseHandle(HANDLE(processGroup_));processGroup_=nullptr;}
#endif
    try {
        write(folder_+"/stderr.log",stderr_.right(1024*1024));
        if(!stopped_.isEmpty()) record_["status"]=stopped_;
        else if(exitCode!=0||status!=QProcess::NormalExit) {
            record_["status"]="failed";
            if(!record_.contains("message")) record_["message"]=process_.errorString()+" / "+QString::fromUtf8(stderr_.right(2000));
        } else {
            verify(folder_,record_);record_["resultSha256"]=hash(read(folder_+"/result.json"));record_["status"]="completed";
        }
    } catch(const std::exception& e) {record_["status"]="failed";record_["message"]=QString::fromUtf8(e.what());}
    record_["finishedAt"]=QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);
    try {save();} catch(const std::exception& e) {record_["status"]="storage_failed";record_["message"]=QString::fromUtf8(e.what());}
    lock_.reset();finishing_=false;if(changed) changed();
}
void Job::stop(const QString& reason) {
    if(!active()||!stopped_.isEmpty()) return;stopped_=reason;timeout_.stop();
#ifdef Q_OS_WIN
    if(processGroup_) TerminateJobObject(HANDLE(processGroup_),1);
#endif
    process_.kill();
    if(process_.state()==QProcess::NotRunning&&!finishing_) finish(-1,QProcess::CrashExit);
}
void Job::cancel() {stop("cancelled");}
QJsonObject Job::reopen(const QString& id) const {
    require(runIdValid(id),"任务身份无效");auto dir=repository_.root()+"/jobs/"+id;plainDirectory(repository_.root(),dir);
    auto record=object(read(dir+"/record.json"));require(record.value("runId")==id,"任务目录身份不一致");
    if(record.value("status")=="completed") record["result"]=verify(dir,record);
    const auto requestBytes=read(dir+"/request.json");
    require(hash(requestBytes)==record.value("requestSha256").toString(),"冻结请求已变化");
    record["request"]=object(requestBytes);
    return record;
}
QByteArray Job::exportResult(const QString& id) const {
    auto record=reopen(id);require(record.value("status")=="completed","只能导出完整且已核验的结果");
    auto dir=repository_.root()+"/jobs/"+id;
    auto manifest=object(read(dir+"/plugin/manifest.json"));
    QStringList paths{"record.json","request.json",frozenInputName(object(read(dir+"/request.json"))),"result.json","plugin/manifest.json"};
    for(auto path:manifest.value("files").toObject().keys())paths.append("plugin/"+path);
    QJsonArray files;qint64 total=0;
    for(auto path:paths){auto raw=read(dir+"/"+path);total+=raw.size();require(total<=48*1024*1024,"结果包原文超过48MiB");
        files.append(QJsonObject{{"path",path},{"sha256",hash(raw)},{"base64",QString::fromLatin1(raw.toBase64())}});}
    return QJsonDocument(QJsonObject{{"schema","webstock.plugin.archive.v1"},{"runId",id},{"files",files}}).toJson(QJsonDocument::Compact);
}
QString Job::importResult(const QByteArray& bytes) {
    require(bytes.size()<=68*1024*1024,"结果包超过68MiB");auto archive=object(bytes);
    auto id=archive.value("runId").toString();require(archive.value("schema")=="webstock.plugin.archive.v1"&&runIdValid(id),"结果包格式无效");
    auto files=archive.value("files").toArray();require(files.size()>=5&&files.size()<=261,"结果文件数量无效");
    QMap<QString,QByteArray> content;QSet<QString> names;qint64 total=0;
    for(auto v:files){auto file=v.toObject();auto path=file.value("path").toString();auto encoded=file.value("base64").toString().toLatin1();
        auto raw=QByteArray::fromBase64(encoded,QByteArray::AbortOnBase64DecodingErrors);total+=raw.size();
        require(relative(path)&&!names.contains(path.toLower())&&raw.toBase64()==encoded&&hash(raw)==file.value("sha256").toString()&&raw.size()<=24*1024*1024&&total<=48*1024*1024,"结果文件路径、大小或摘要无效");
        names.insert(path.toLower());content[path]=raw;
    }
    require(content.contains("request.json"),"结果包缺少请求");
    QSet<QString> expected{"record.json","request.json",frozenInputName(object(content["request.json"])),"result.json","plugin/manifest.json"};
    for(auto path:expected)require(content.contains(path),"结果包缺少必需文件");
    auto manifest=validateManifest(object(content["plugin/manifest.json"]));
    for(auto path:manifest.value("files").toObject().keys())expected.insert("plugin/"+path);
    require(expected.size()==content.size(),"结果包包含多余文件");for(auto path:expected)require(content.contains(path),"结果包缺少冻结代码");
    auto record=object(content["record.json"]);require(record.value("runId")==id&&record.value("status")=="completed"&&record.contains("resultSha256"),"只允许导入已完成结果，未启动任何任务");
    auto dir=repository_.root()+"/jobs/"+id;plainDirectory(repository_.root(),dir);
    QLockFile importLock(repository_.root()+"/archives.lock");require(importLock.tryLock(0),"另一个窗口正在导入结果");
    if(QFileInfo::exists(dir)){
        for(auto i=content.begin();i!=content.end();++i)require(read(dir+"/"+i.key())==i.value(),"同一任务身份存在不同内容，原记录保留");
        verify(dir,record);return id;
    }
    auto staging=repository_.root()+"/jobs/.import-"+QUuid::createUuid().toString(QUuid::WithoutBraces);
    require(QDir().mkpath(staging),"无法准备结果目录");
    for(auto i=content.begin();i!=content.end();++i){require(QDir().mkpath(QFileInfo(staging+"/"+i.key()).absolutePath()),"无法创建结果子目录");write(staging+"/"+i.key(),i.value());}
    verify(staging,record);require(QDir().rename(staging,dir),"无法保存导入结果");return id;
}
}
