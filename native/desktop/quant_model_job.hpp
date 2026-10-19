#pragma once
#include <QCoreApplication>
#include <QCryptographicHash>
#include <QDate>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMap>
#include <QSet>
#include <QLockFile>
#include <QProcess>
#include <QProcessEnvironment>
#include <QRegularExpression>
#include <QSaveFile>
#include <QTimer>
#include <QUuid>
#include <functional>
#include <memory>
#include <stdexcept>
#include "watchlist_backup_model.hpp"
#ifdef Q_OS_WIN
#include <windows.h>
#endif

namespace quantModel {
inline void need(bool ok,const QString& message){if(!ok)throw std::runtime_error(message.toUtf8().constData());}
inline QString hash(const QByteArray& bytes){return QString::fromLatin1(QCryptographicHash::hash(bytes,QCryptographicHash::Sha256).toHex());}
inline QByteArray read(const QString& path,qint64 limit=32*1024*1024){QFile file(path);need(file.open(QIODevice::ReadOnly)&&file.size()<=limit,"文件缺失、不可读或超过大小限制："+path);return file.readAll();}
inline QJsonObject object(const QByteArray& bytes){watchlistBackup::JsonGate{QString::fromUtf8(bytes)}.run();QJsonParseError error;auto document=QJsonDocument::fromJson(bytes,&error);need(error.error==QJsonParseError::NoError&&document.isObject(),"完整JSON对象损坏");return document.object();}
inline void write(const QString& path,const QByteArray& bytes){QSaveFile file(path);need(file.open(QIODevice::WriteOnly)&&file.write(bytes)==bytes.size()&&file.commit(),"无法完整保存任务文件："+path);}
inline void write(const QString& path,const QJsonObject& value){write(path,QJsonDocument(value).toJson(QJsonDocument::Indented));}
inline bool relativePath(const QString& path){return !path.isEmpty()&&!QDir::isAbsolutePath(path)&&!path.contains('\\')&&!path.contains(':')&&!path.split('/').contains("..")&&!path.split('/').contains(".")&&!path.split('/').contains("");}
inline QJsonObject verifyBundle(const QByteArray& bytes,const QString& expectedRequestHash={}){
 need(bytes.size()<=32*1024*1024,"结果包超过32MiB");auto receipt=object(bytes);
 need(receipt.value("schema")=="webstock.quant.native-result.v1"&&receipt.value("status")=="completed"&&receipt.value("automaticTrading")==false,"结果包状态/格式错误");
 auto requestHash=receipt.value("requestSha256").toString();need(expectedRequestHash.isEmpty()||requestHash==expectedRequestHash,"结果属于另一任务");
 QMap<QString,QByteArray> files;qint64 total=0;
 for(auto value:receipt.value("files").toArray()){
  auto file=value.toObject();auto path=file.value("path").toString();auto encoded=file.value("base64").toString().toLatin1();auto decoded=QByteArray::fromBase64(encoded,QByteArray::AbortOnBase64DecodingErrors);
  need(relativePath(path)&&!files.contains(path)&&decoded.toBase64()==encoded&&hash(decoded)==file.value("sha256").toString(),"结果附件路径、编码或摘要不一致");
  total+=decoded.size();need(total<=24*1024*1024,"结果附件超过24MiB");files.insert(path,decoded);
 }
 need(files.contains("request.json")&&hash(files["request.json"])==requestHash,"冻结请求缺失或变更");auto request=object(files["request.json"]);
 need(request.value("id")==receipt.value("id")&&request.value("task")==receipt.value("task"),"结果任务身份不一致");
 need(request.value("schema")=="webstock.quant.native-request.v1"&&QRegularExpression("^native-[0-9a-f-]{36}$").match(receipt.value("id").toString()).hasMatch(),"请求格式或任务ID无效");
 auto datasetId=receipt.value("datasetId").toString();auto manifestPath="workspace/datasets/"+datasetId+"/manifest.json";
 need(files.contains(manifestPath)&&hash(files[manifestPath])==request.value("manifestFileSha256").toString(),"数据清单原文不一致");auto manifest=object(files[manifestPath]);
 need(manifest.value("datasetId")==receipt.value("datasetId")&&manifest.value("manifestSha256")==receipt.value("manifestSha256")&&manifest.value("asOf")==receipt.value("asOf"),"数据身份/时点不一致");
 need(manifest.value("schema")=="webstock.quant.dataset.v1","数据清单格式不一致");
 auto task=request.value("task").toString();auto steps=receipt.value("steps").toArray();int count=task=="experiment"?3:(task=="watchlist"||task=="strategy-daily"?4:1);
 need(QStringList{"lightgbm","master","factor","strategy","signal","experiment","watchlist","strategy-daily"}.contains(task)&&steps.size()==count,"任务步骤不完整");
 for(int i=0;i<steps.size();++i){
  auto entry=steps[i].toObject(),step=entry.value("step").toObject();auto path=entry.value("relativePath").toString();
  need(files.contains(path)&&hash(files[path])==entry.value("sha256").toString(),"结果原文摘要不一致");auto result=object(files[path]);need(result==entry.value("result").toObject(),"结果摘要与原文不一致");
  auto kind=task=="experiment"?QStringList{"lightgbm","factor","master"}[i]:(count==4?QString("strategy"):task);
  auto runId=receipt.value("id").toString()+"-"+QString::number(i+1);auto directory=kind=="factor"?"factor-runs":kind=="strategy"?"strategy-runs":kind=="signal"?"signal-scans":"runs";
  need(step.value("kind")==kind&&step.value("runId")==runId&&path=="workspace/"+QString(directory)+"/"+runId+"/result.json"&&result.value("runId")==runId&&result.value("status")=="completed","结果模型任务或路径不一致");
  auto expectedSchema=(kind=="lightgbm"||kind=="master")?QString("webstock.quant.result.v1"):kind=="factor"?QString("webstock.quant.factor-lab.v1"):kind=="strategy"?QString("webstock.quant.strategy-lab.v1"):QString("webstock.quant.signal-scan.v1");
  need(result.value("schema")==expectedSchema,"结果类型不一致");
  if(kind=="lightgbm"||kind=="master")need(result.value("modelId")== (kind=="lightgbm"?"qlib-lightgbm-v2":"master-market-guided-v1"),"模型身份不一致");
  auto data=result.value("dataManifest").toObject();need(data.value("datasetId")==receipt.value("datasetId")&&data.value("sha256")==receipt.value("manifestSha256"),"结果使用另一数据版本");
  auto when=QDate::fromString(result.value("asOf").toString(),Qt::ISODate),limit=QDate::fromString(receipt.value("asOf").toString(),Qt::ISODate);need(when.isValid()&&limit.isValid()&&when<=limit,"结果日期无效或超过数据日期");
  if(kind=="strategy"||kind=="signal"){auto family=count==4?QStringList{"moving-average-crossover","macd-crossover","rsi-rebound","volume-breakout"}[i]:request.value("parameters").toObject().value("strategyFamily").toString(kind=="signal"?"low-position-volume-stagnation":"moving-average-crossover");need(step.value("family")==family&&result.value("ruleCard").toObject().value("strategyFamily")==family&&when==limit&&result.value("automaticTrading")==false,"策略身份、时点或执行权限不一致");}
  if(kind=="lightgbm"||kind=="master"||kind=="factor"){auto parameters=step.value("parameters").toObject(),actual=result.value("parameters").toObject(),supplied=request.value("parameters").toObject();need(!result.value("folds").toArray().isEmpty()&&!parameters.isEmpty(),"模型窗口或参数缺失");for(auto it=parameters.begin();it!=parameters.end();++it)need(actual.value(it.key())==it.value()&&(!supplied.contains(it.key())||supplied.value(it.key())==it.value()),"模型参数与冻结请求不一致");}
  auto artifacts=result.value("artifacts").toArray();need(!artifacts.isEmpty(),"缺少实际结果附件");QSet<QString>seen;
  for(auto artifact:artifacts){auto file=artifact.toObject();auto rel=file.value("path").toString();auto attachment=path.left(path.lastIndexOf('/')+1)+rel;need(relativePath(rel)&&rel!="result.json"&&!seen.contains(rel)&&files.contains(attachment)&&hash(files[attachment])==file.value("sha256").toString(),"结果附件未通过完整核对");seen.insert(rel);}
 }
 if(count==4){need(files.contains("suite-report.json"),"四策略汇总缺失");auto report=object(files["suite-report.json"]);need(report==receipt.value("report").toObject()&&report.value("status")=="complete"&&report.value("datasetId")==receipt.value("datasetId")&&report.value("manifestSha256")==receipt.value("manifestSha256")&&report.value("comparisons").toArray().size()==4,"四策略汇总不一致");}
 if(task=="watchlist"){need(files.contains("watchlist-review.json"),"自选研究解读缺失");auto review=object(files["watchlist-review.json"]);need(review==receipt.value("watchlist").toObject()&&review.value("group")==request.value("watchlist")&&review.value("recommendationPreview").toObject().value("automaticApply")==false,"自选研究解读或分组不一致");}
 return receipt;
}

class Job:public QObject {
 QProcess process;QTimer deadline;std::unique_ptr<QLockFile> lock;
 QString root,folder;QJsonObject state;QByteArray output,stderrBytes;QJsonObject terminal;QString protocolError;bool cancelled=false,timedOut=false;int terminalCount=0;qint64 outputBytes=0;
 void save(){state["updatedAt"]=QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);write(folder+"/state.json",state);if(changed)changed(state);}
 void consume(){
  auto bytes=process.readAllStandardOutput();outputBytes+=bytes.size();if(outputBytes>16*1024*1024){protocolError="任务输出超过16MiB";stop();return;}output+=bytes;
  while(output.contains('\n')){int end=output.indexOf('\n');auto line=output.left(end).trimmed();output.remove(0,end+1);try{
   if(line.startsWith("WEBSTOCK_NATIVE_EVENT=")){auto event=object(line.mid(22));need(event.value("id")==state.value("id"),"进度来自另一任务");state["progress"]=event;save();}
   else if(line.startsWith("WEBSTOCK_NATIVE_RESULT=")){terminal=object(line.mid(23));++terminalCount;}
   else if(line.startsWith("WEBSTOCK_NATIVE_ERROR=")){protocolError=object(line.mid(22)).value("message").toString();}
  }catch(const std::exception& error){protocolError=QString::fromUtf8(error.what());stop();return;}}
 }
 void stop(){
  if(process.state()==QProcess::NotRunning)return;
#ifdef Q_OS_WIN
  QProcess killer;killer.setProgram("taskkill");killer.setArguments({"/PID",QString::number(process.processId()),"/T","/F"});killer.start();if(!killer.waitForFinished(3000)){killer.kill();killer.waitForFinished(1000);}
#else
  process.kill();
#endif
  if(process.state()!=QProcess::NotRunning)process.kill();
 }
 void finish(int exitCode,QProcess::ExitStatus exitStatus){
  deadline.stop();consume();auto errors=stderrBytes+process.readAllStandardError();try{
   if(!errors.isEmpty())write(folder+"/stderr.txt",errors.left(1024*1024));
   state["exitCode"]=exitCode;
   if(cancelled)state["status"]="cancelled";
   else if(timedOut){state["status"]="failed";state["error"]="任务达到时间上限";}
   else{
    need(protocolError.isEmpty(),protocolError);need(exitStatus==QProcess::NormalExit&&exitCode==0&&terminalCount==1&&output.trimmed().isEmpty(),"任务异常结束或缺少唯一终态");
    need(terminal.value("id")==state.value("id")&&terminal.value("requestSha256")==state.value("requestSha256")&&QFileInfo(terminal.value("resultPath").toString()).absoluteFilePath()==QFileInfo(folder+"/verified-result.json").absoluteFilePath(),"任务回包身份/路径错误");
    auto bytes=read(folder+"/verified-result.json");need(hash(bytes)==terminal.value("sha256").toString(),"结果文件在回包后改变");verifyBundle(bytes,state.value("requestSha256").toString());
    state["status"]="completed";state["resultSha256"]=hash(bytes);
   }
  }catch(const std::exception& error){state["status"]="failed";state["error"]=QString::fromUtf8(error.what());}
  state["finishedAt"]=QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);try{save();}catch(const std::exception& error){if(failed)failed(QString::fromUtf8(error.what()));}lock.reset();
 }
public:
 std::function<void(QJsonObject)> changed;std::function<void(QString)> failed;
 explicit Job(QString directory,QObject* parent=nullptr):QObject(parent),root(QFileInfo(directory).absoluteFilePath()){
  need(QDir().mkpath(root),"任务目录不可用");deadline.setSingleShot(true);
  {QLockFile recovery(root+"/.running.lock");if(recovery.tryLock(0)){for(auto value:records()){auto old=value.toObject();auto id=old.value("id").toString();need(QRegularExpression("^native-[0-9a-f-]{36}$").match(id).hasMatch(),"旧任务身份损坏");if(QStringList{"queued","running","cancelling"}.contains(old.value("status").toString())){old["status"]="interrupted";old["error"]="上次进程已结束，未自动重跑";write(root+"/"+id+"/state.json",old);}}}}
  connect(&deadline,&QTimer::timeout,this,[this]{timedOut=true;stop();});
  connect(&process,&QProcess::readyReadStandardOutput,this,[this]{consume();});
  connect(&process,&QProcess::readyReadStandardError,this,[this]{stderrBytes+=process.readAllStandardError();try{write(folder+"/stderr.txt",stderrBytes.left(1024*1024));}catch(...){}if(stderrBytes.size()>1024*1024){stderrBytes.truncate(1024*1024);protocolError="错误日志超过1MiB";stop();}});
  connect(&process,&QProcess::finished,this,[this](int code,QProcess::ExitStatus status){finish(code,status);});
  connect(&process,&QProcess::errorOccurred,this,[this](QProcess::ProcessError error){if(error==QProcess::FailedToStart){protocolError=process.errorString();finish(-1,QProcess::CrashExit);}});
 }
 ~Job()override{cancel();process.waitForFinished(3000);}
 bool active()const{return process.state()!=QProcess::NotRunning;}
 QJsonObject current()const{return state;}
 QString directory()const{return root;}
 void cancel(){if(active()){cancelled=true;state["status"]="cancelling";try{save();}catch(...){}stop();}}
 void start(QString python,QString runner,QJsonObject request,int maximumSeconds=600){
  need(!active(),"已有任务运行");need(maximumSeconds>=5&&maximumSeconds<=3600,"时间上限必须为5–3600秒");
  need(QFileInfo(python).isFile()&&QFileInfo(python).isExecutable()&&QFileInfo(runner).isFile(),"先选择现有Python运行环境和native_runner.py");
  auto acquired=std::make_unique<QLockFile>(root+"/.running.lock");need(acquired->tryLock(0),"此研究库已有模型任务运行");
  auto id="native-"+QUuid::createUuid().toString(QUuid::WithoutBraces);folder=root+"/"+id;need(QDir().mkpath(folder+"/engine/webstock_quant"),"无法创建独立任务目录");
  auto source=QFileInfo(runner).absolutePath();QJsonObject engineHashes;
  QStringList relative{"native_runner.py"};for(auto info:QDir(source+"/webstock_quant").entryInfoList({"*.py"},QDir::Files|QDir::NoSymLinks))relative<<"webstock_quant/"+info.fileName();
  need(relative.contains("webstock_quant/cli.py")&&relative.contains("webstock_quant/model.py")&&relative.contains("webstock_quant/master_model.py")&&relative.size()<=128,"模型程序目录不完整");
  for(auto path:relative){auto bytes=read(source+"/"+path,4*1024*1024);write(folder+"/engine/"+path,bytes);engineHashes[path]=hash(bytes);}
  request["schema"]="webstock.quant.native-request.v1";request["id"]=id;request["manifestPath"]=QFileInfo(request.value("manifestPath").toString()).absoluteFilePath();request["manifestFileSha256"]=hash(read(request.value("manifestPath").toString()));request["engineHashes"]=engineHashes;
  auto bytes=QJsonDocument(request).toJson(QJsonDocument::Indented);write(folder+"/request.json",bytes);state={{"schema","webstock.quant.native-job.v1"},{"id",id},{"task",request.value("task")},{"requestSha256",hash(bytes)},{"status","running"},{"scheduled",request.value("scheduled").toBool(false)},{"scheduleDate",request.value("scheduleDate")},{"python",QFileInfo(python).absoluteFilePath()},{"createdAt",QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)}};
  cancelled=false;timedOut=false;terminalCount=0;outputBytes=0;output.clear();stderrBytes.clear();terminal={};protocolError.clear();save();lock=std::move(acquired);
  auto env=QProcessEnvironment::systemEnvironment();env.insert("PYTHONUTF8","1");env.insert("WEBSTOCK_QUANT_THREADS","1");env.insert("PYTHONFAULTHANDLER","1");env.insert("PYTHONDONTWRITEBYTECODE","1");env.remove("PYTHONPATH");
  for(auto name:{"OMP_NUM_THREADS","MKL_NUM_THREADS","OPENBLAS_NUM_THREADS","NUMEXPR_NUM_THREADS"})env.insert(name,"1");
  env.insert("HF_HUB_OFFLINE","1");env.insert("TRANSFORMERS_OFFLINE","1");env.insert("WEBSTOCK_QUANT_TRACKING_DIR",root+"/.runtime");env.insert("TORCH_HOME",folder+"/cache/torch");env.insert("MPLCONFIGDIR",folder+"/cache/mpl");env.insert("MLFLOW_ALLOW_FILE_STORE","true");
  process.setProcessEnvironment(env);process.setWorkingDirectory(folder);process.setProgram(python);process.setArguments({"-u",folder+"/engine/native_runner.py",folder+"/request.json"});
#ifdef Q_OS_WIN
  process.setCreateProcessArgumentsModifier([](QProcess::CreateProcessArguments* args){args->flags|=CREATE_NO_WINDOW;});
#endif
  deadline.start(maximumSeconds*1000);process.start();
 }
 QJsonArray records()const{QJsonArray result;for(auto info:QDir(root).entryInfoList({"native-*"},QDir::Dirs|QDir::NoDotAndDotDot,QDir::Time)){auto file=info.absoluteFilePath()+"/state.json";if(QFileInfo::exists(file))result.append(object(read(file,1024*1024)));}return result;}
 QString importBundle(const QByteArray& bytes){
  need(!active(),"先结束当前任务再导入结果");auto receipt=verifyBundle(bytes);auto id=receipt.value("id").toString();need(QRegularExpression("^native-[0-9a-f-]{36}$").match(id).hasMatch(),"导入任务ID无效");
  QLockFile archiveLock(root+"/.archives.lock");need(archiveLock.tryLock(1000),"结果目录正在保存");auto target=root+"/"+id;
  if(QFileInfo::exists(target)){auto saved=reopen(id);need(saved.value("status")=="completed"&&saved.value("resultSha256")==hash(bytes),"同ID已有其他任务或原文，未覆盖");return id;}
  need(QDir().mkpath(target),"不能创建独立结果目录");write(target+"/verified-result.json",bytes);
  write(target+"/state.json",QJsonObject{{"schema","webstock.quant.native-job.v1"},{"id",id},{"task",receipt.value("task")},{"status","completed"},{"origin","offline-result-import; not executed on this machine"},{"requestSha256",receipt.value("requestSha256")},{"resultSha256",hash(bytes)},{"createdAt",receipt.value("createdAt")},{"importedAt",QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)}});return id;
 }
 QJsonObject reopen(QString id)const{need(QRegularExpression("^native-[0-9a-f-]{36}$").match(id).hasMatch(),"任务ID无效");auto saved=object(read(root+"/"+id+"/state.json"));need(saved.value("schema")=="webstock.quant.native-job.v1"&&saved.value("id")==id,"任务状态身份损坏");if(saved.value("status")=="completed"){auto bytes=read(root+"/"+id+"/verified-result.json");need(hash(bytes)==saved.value("resultSha256").toString(),"保存后结果包发生变化");auto result=verifyBundle(bytes,saved.value("requestSha256").toString());need(result.value("id")==saved.value("id")&&result.value("task")==saved.value("task"),"结果与归档状态身份不同");saved["result"]=result;}return saved;}
};
}
