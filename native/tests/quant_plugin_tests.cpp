#include "quant_plugin_host.hpp"
#include <QTest>
#include <QTemporaryDir>
#include <QFile>
#include <QJsonDocument>
#include <QDir>
#include "quant_plugin_widget.hpp"
#include <QLineEdit>
#include <QComboBox>
#include <QCheckBox>
#include <QPushButton>
#include <QTabWidget>
#include <QListWidget>
#include <QFontDatabase>
using namespace quantPlugin;

class PluginTests:public QObject{
    Q_OBJECT
    QJsonObject manifest(QByteArray code="print('test')\n"){
        return {{"schema","webstock.plugin.manifest.v1"},{"protocolVersion",1},{"id","org.test.engine"},{"version","0.1.0"},
            {"name","Test engine"},{"license","test fixture"},{"runtime","python"},{"entrypoint","worker.py"},
            {"files",QJsonObject{{"worker.py",hash(code)}}},
            {"operations",QJsonArray{QJsonObject{{"id","test"},{"title","Test"},{"formulaVersion","fixture-v1"},
                {"inputKind","ohlcv-single-csv"},{"outputKind","indicator"},{"parameters",QJsonArray{}}}}}};
    }
    QByteArray package(QJsonObject m,QByteArray code="print('test')\n"){
        return QJsonDocument(QJsonObject{{"schema","webstock.plugin.package.v1"},{"manifest",m},
            {"files",QJsonObject{{"worker.py",QString::fromLatin1(code.toBase64())}}}}).toJson();
    }
private slots:
    void initTestCase(){
#ifdef Q_OS_WIN
        auto font=QFontDatabase::addApplicationFont("C:/Windows/Fonts/msyh.ttc");
        if(font>=0)QApplication::setFont(QFont(QFontDatabase::applicationFontFamilies(font).first(),10));
#endif
    }
    void installIntegrity(){
        QTemporaryDir dir;Repository repo(dir.path());auto m=manifest();auto p=repo.install(package(m));
        QCOMPARE(repo.plugins().size(),1);QCOMPARE(repo.plugin("org.test.engine").value("manifest").toObject(),m);
        repo.install(package(m));QCOMPARE(repo.plugins().size(),1);
        QVERIFY_EXCEPTION_THROWN(repo.install(package(m,"changed")),std::runtime_error);
        auto changed=manifest("changed");QVERIFY_EXCEPTION_THROWN(repo.install(package(changed,"changed")),std::runtime_error);
        QCOMPARE(repo.plugin("org.test.engine").value("manifest").toObject(),m);
        write(repo.directory(p)+"/manifest.json",QByteArray("{}"));QVERIFY_EXCEPTION_THROWN(repo.plugin("org.test.engine"),std::runtime_error);
    }
    void rejectsAmbiguousAndUnsafe(){
        QVERIFY_EXCEPTION_THROWN(object("{\"x\":1,\"x\":2}"),std::runtime_error);
        QVERIFY_EXCEPTION_THROWN(object("{\"x\":NaN}"),std::runtime_error);
        for(auto path:QStringList{"../worker.py","/worker.py","C:/worker.py","a\\worker.py","CON.py","a./worker.py"}){
            auto m=manifest();m["entrypoint"]=path;m["files"]=QJsonObject{{path,hash("x")}};QVERIFY_EXCEPTION_THROWN(validateManifest(m),std::runtime_error);
        }
        auto m=manifest();m["files"]=QJsonObject{{"worker.py",hash("x")},{"WORKER.py",hash("x")}};QVERIFY_EXCEPTION_THROWN(validateManifest(m),std::runtime_error);
    }
    void inputAndTaskGuards(){
        QTemporaryDir dir;Repository repo(dir.path());repo.install(package(manifest()));Job job(dir.path());
        QVERIFY_EXCEPTION_THROWN(job.reopen("../outside"),std::runtime_error);
        QVERIFY_EXCEPTION_THROWN(job.start("org.test.engine","test","none",{},{{"closedBarsOnly",true},{"adjustment","unknown"}}),std::runtime_error);
        repo.configure("org.test.engine",{},false);QVERIFY_EXCEPTION_THROWN(job.start("org.test.engine","test","none",{},{}),std::runtime_error);
    }
    void parameterValidation(){
        QJsonObject op{{"parameters",QJsonArray{QJsonObject{{"id","n"},{"type","integer"},{"default",20},{"minimum",2},{"maximum",100}}}}};
        QCOMPARE(validateParameters(op,{}).value("n").toInt(),20);
        QVERIFY_EXCEPTION_THROWN(validateParameters(op,{{"n",2.5}}),std::runtime_error);
        QVERIFY_EXCEPTION_THROWN(validateParameters(op,{{"n",true}}),std::runtime_error);
        QVERIFY_EXCEPTION_THROWN(validateParameters(op,{{"arbitrary",1}}),std::runtime_error);
    }
    void generatedDataAndCsvExports(){
        QByteArray bytes("native data\0bytes",17);
        QJsonObject artifact{{"name","input.dsb"},{"sha256",hash(bytes)},{"base64",QString::fromLatin1(bytes.toBase64())}};
        QCOMPARE(generatedData(artifact),bytes);
        auto damaged=artifact;damaged["sha256"]=hash("different");QVERIFY_EXCEPTION_THROWN(generatedData(damaged),std::runtime_error);
        damaged=artifact;damaged["name"]="../outside.dsb";QVERIFY_EXCEPTION_THROWN(generatedData(damaged),std::runtime_error);
        damaged=artifact;damaged["base64"]="%%%";QVERIFY_EXCEPTION_THROWN(generatedData(damaged),std::runtime_error);
        auto csv=tableCsv({{"columns",QJsonArray{"label","value"}},{"rows",QJsonArray{
            QJsonArray{"a,\"b",-3.5},QJsonArray{"=1+1",QJsonValue()}}}});
        QVERIFY(csv.startsWith("\xEF\xBB\xBF"));QVERIFY(csv.contains("\"a,\"\"b\",\"-3.5\""));
        QVERIFY(csv.contains("\"'=1+1\",\"\""));
        QVERIFY_EXCEPTION_THROWN(tableCsv({{"columns",QJsonArray{"x"}},{"rows",QJsonArray{QJsonArray{1,2}}}}),std::runtime_error);
    }
    void parameterQueryArchives(){
        auto python=qEnvironmentVariable("WEBSTOCK_TEST_PYTHON");if(python.isEmpty())QSKIP("Set WEBSTOCK_TEST_PYTHON for query lifecycle test");
        QByteArray code=R"PY(import json,hashlib,pathlib,sys
r=pathlib.Path(sys.argv[1]);root=r.parent;q=json.loads(r.read_text());m=json.loads((root/'plugin/manifest.json').read_text())
query=json.loads((root/'input.json').read_text());assert query['parameters']==q['parameters'];assert query['schema']=='webstock.plugin.query.v1'
assert not (root/'input.csv').exists()
out=dict(schema='webstock.plugin.result.v1',status='completed',automaticTrading=False,runId=q['runId'],pluginId=m['id'],pluginVersion=m['version'],operationId=q['operationId'],requestSha256=hashlib.sha256(r.read_bytes()).hexdigest(),manifestSha256=q['manifestSha256'],inputSha256=q['input']['sha256'],parameters=q['parameters'],dataPolicy=q['input'],kind='data',engineVersion='test-fixture',formulaVersion='fixture-v1',warnings=[],tables=[dict(id='market-data',columns=['date','value'],rows=[[q['parameters']['date'],1]])])
(root/'result.json').write_text(json.dumps(out))
)PY";
        auto m=manifest(code);m["version"]="0.7.0";auto op=m.value("operations").toArray()[0].toObject();op["inputKind"]="parameters-only";op["outputKind"]="data";
        op["parameters"]=QJsonArray{QJsonObject{{"id","date"},{"title","日期"},{"type","text"},{"format","date"},{"minLength",10},{"maxLength",10},{"default","2020-01-01"}}};m["operations"]=QJsonArray{op};
        QVERIFY_EXCEPTION_THROWN(validateParameters(op,{{"date","2020-02-31"}}),std::runtime_error);
        QVERIFY_EXCEPTION_THROWN(validateParameters(op,{{"date","20200101"}}),std::runtime_error);
        QVERIFY_EXCEPTION_THROWN(validateParameters(op,{{"date",123}}),std::runtime_error);
        QTemporaryDir dir;Repository repo(dir.path());repo.install(package(m,code));repo.configure("org.test.engine",python,true);
        QuantPluginWidget widget(dir.path());widget.show();
        QVERIFY(!widget.findChild<QLineEdit*>("pluginInput")->isVisible());
        auto date=widget.findChild<QLineEdit*>("pluginParam_date");QVERIFY(date);date->setText("2020-02-03");
        QTest::mouseClick(widget.findChild<QPushButton*>("pluginRun"),Qt::LeftButton);
        Job reader(dir.path());QTRY_VERIFY_WITH_TIMEOUT(!reader.records().isEmpty()&&reader.records()[0].toObject().value("status")=="completed",10000);
        auto id=reader.records()[0].toObject().value("runId").toString();auto result=reader.reopen(id).value("result").toObject();
        QCOMPARE(result.value("parameters").toObject().value("date").toString(),QString("2020-02-03"));
        auto bytes=reader.exportResult(id);QTemporaryDir copy;Job importer(copy.path());QCOMPARE(importer.importResult(bytes),id);
        QCOMPARE(importer.reopen(id).value("result").toObject(),result);QVERIFY(!importer.active());
        QuantPluginWidget reopened(dir.path());
        QCOMPARE(reopened.findChild<QLineEdit*>("pluginParam_date")->text(),QString("2020-02-03"));
        QVERIFY_EXCEPTION_THROWN(repo.rememberParameters("org.test.engine","test",{{"date","2020-02-31"}}),std::runtime_error);
    }
    void recoversWithoutReplay(){
        QTemporaryDir dir;Repository repo(dir.path());QString id="plugin-12345678-1234-1234-1234-123456789abc";
        auto folder=dir.path()+"/jobs/"+id;QDir().mkpath(folder);write(folder+"/record.json",QJsonObject{{"runId",id},{"status","running"}});
        {Job job(dir.path());QCOMPARE(job.records()[0].toObject().value("status").toString(),QString("interrupted"));QVERIFY(!job.active());}
        write(folder+"/record.json",QJsonObject{{"runId",id},{"status","running"}});QLockFile lock(folder+"/run.lock");QVERIFY(lock.tryLock());
        Job second(dir.path());QCOMPARE(second.records()[0].toObject().value("status").toString(),QString("running"));
    }
    void cancelAndTimeoutTerminateDescendants(){
        auto python=qEnvironmentVariable("WEBSTOCK_TEST_PYTHON");if(python.isEmpty())QSKIP("Set WEBSTOCK_TEST_PYTHON for real process lifecycle tests");
        QTemporaryDir dir;Repository repo(dir.path());
        QByteArray code="import pathlib,subprocess,sys,time\nroot=pathlib.Path(sys.argv[1]).parent\nsubprocess.Popen([sys.executable,'-c',\"import time,pathlib;time.sleep(2);pathlib.Path('escaped-child.txt').write_text('alive')\"])\n(root/'started.txt').write_text('ready')\ntime.sleep(30)\n";
        repo.install(package(manifest(code),code));repo.configure("org.test.engine",python,true);
        auto input=dir.path()+"/input.csv";write(input,QByteArray("test input\n"));Job job(dir.path());
        auto policy=QJsonObject{{"closedBarsOnly",true},{"adjustment","unknown"}};
        job.start("org.test.engine","test",input,{},policy,10);auto id=job.current().value("runId").toString();
        auto folder=dir.path()+"/jobs/"+id;QTRY_VERIFY_WITH_TIMEOUT(QFileInfo::exists(folder+"/started.txt"),10000);
        QVERIFY_EXCEPTION_THROWN(job.start("org.test.engine","test",input,{},policy),std::runtime_error);
        job.cancel();QTRY_VERIFY_WITH_TIMEOUT(!job.active(),5000);QCOMPARE(job.current().value("status").toString(),QString("cancelled"));
        QTest::qWait(2200);QVERIFY(!QFileInfo::exists(folder+"/escaped-child.txt"));
        job.start("org.test.engine","test",input,{},policy,1);QTRY_VERIFY_WITH_TIMEOUT(!job.active(),5000);
        QCOMPARE(job.current().value("status").toString(),QString("timed_out"));
    }
    void realNativeWidgetRunReopenAndTamper(){
        auto python=qEnvironmentVariable("WEBSTOCK_TEST_PYTHON"),packageFile=qEnvironmentVariable("WEBSTOCK_TEST_PACKAGE"),csv=qEnvironmentVariable("WEBSTOCK_TEST_CSV");
        if(python.isEmpty()||packageFile.isEmpty()||csv.isEmpty())QSKIP("Set real adapter fixture paths");
        QTemporaryDir dir;Repository repo(dir.path());auto p=repo.install(read(packageFile));repo.configure(p.value("id").toString(),python,true);
        QuantPluginWidget widget(dir.path());widget.resize(1280,850);widget.show();
        auto operations=widget.findChild<QComboBox*>("pluginOperation");QVERIFY(operations);
        for(int i=0;i<operations->count();++i)if(operations->itemData(i).toJsonObject().value("id")=="rsi")operations->setCurrentIndex(i);
        widget.findChild<QLineEdit*>("pluginInput")->setText(csv);widget.findChild<QCheckBox*>("pluginClosedBars")->setChecked(true);
        auto run=widget.findChild<QPushButton*>("pluginRun");QVERIFY(run);QTest::mouseClick(run,Qt::LeftButton);
        auto tabs=widget.findChild<QTabWidget*>("pluginResults");QTRY_VERIFY_WITH_TIMEOUT(tabs->count()>=2,15000);
        auto output=qEnvironmentVariable("WEBSTOCK_TEST_SCREENSHOT");if(!output.isEmpty())QVERIFY(widget.grab().save(output));
        Job verifier(dir.path());QCOMPARE(verifier.records().size(),1);auto record=verifier.records()[0].toObject();QCOMPARE(record.value("status").toString(),QString("completed"));
        auto id=record.value("runId").toString();QVERIFY(!verifier.reopen(id).value("result").toObject().isEmpty());
        auto archive=verifier.exportResult(id);QTemporaryDir importedDir;Job imported(importedDir.path());
        QCOMPARE(imported.importResult(archive),id);QCOMPARE(imported.importResult(archive),id);
        QVERIFY(!imported.active());QVERIFY(!imported.reopen(id).value("result").toObject().isEmpty());
        repo.uninstall(p.value("id").toString());QVERIFY(repo.plugins().isEmpty());
        QVERIFY_EXCEPTION_THROWN(repo.plugin(p.value("id").toString()),std::runtime_error);
        QVERIFY(!verifier.reopen(id).value("result").toObject().isEmpty());
        auto resultPath=dir.path()+"/jobs/"+id+"/result.json";auto result=object(read(resultPath));result["pluginId"]="org.other.engine";write(resultPath,result);
        QVERIFY_EXCEPTION_THROWN(verifier.reopen(id),std::runtime_error);
        QVERIFY_EXCEPTION_THROWN(verifier.exportResult(id),std::runtime_error);
    }
};
QTEST_MAIN(PluginTests)
#include "quant_plugin_tests.moc"
