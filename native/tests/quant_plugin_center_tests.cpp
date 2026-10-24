#include <QtTest>
#include <QtWidgets>
#include "quant_plugin_center.hpp"
#include "quant_plugin_widget.hpp"
#include "quant_plugin_ui.hpp"
using namespace quantPlugin;

class PluginCenterTests:public QObject {
    Q_OBJECT
    QString packages_,source_,output_;
    QJsonObject runtimes_;
    QString package(const QString& id)const{return packages_+"/"+id+"-0.26.0.wspkg";}
    void defaults(const QString& root){QDir().mkpath(root);write(root+"/runtime-defaults.json",runtimes_);}
    void install(Repository& repo,const QString& id){repo.install(read(package(id)));}
    void screenshot(QWidget& widget,const QString& name){if(output_.isEmpty())return;QCoreApplication::processEvents();QVERIFY(widget.grab().save(output_+"/"+name+".png"));}
    QString copyArchive(const QString& root,const QString& pluginId,const QString& status="completed"){
        // Read original preview files only; do not instantiate a recovering Job
        // on the user's data root. Tests own every destination file.
        for(auto name:QDir(source_+"/jobs").entryList(QDir::Dirs|QDir::NoDotAndDotDot,QDir::Name)){
            auto folder=source_+"/jobs/"+name;QJsonObject r;try{r=object(read(folder+"/record.json"));}catch(const std::exception&){continue;}
            if(r.value("pluginId")!=pluginId||r.value("status")!=status)continue;
            auto destination=root+"/jobs/"+name;QDirIterator files(folder,QDir::Files|QDir::NoDotAndDotDot,QDirIterator::Subdirectories);
            while(files.hasNext()){auto path=files.next();auto relative=QDir(folder).relativeFilePath(path);if(relative=="run.lock")continue;QDir().mkpath(QFileInfo(destination+"/"+relative).absolutePath());require(QFile::copy(path,destination+"/"+relative),"测试归档复制失败");}return name;
        }
        return {};
    }
    void select(QuantPluginCenter& center,const QString& id){auto table=center.findChild<QTableWidget*>("pluginCatalog");for(int row=0;row<table->rowCount();++row)if(table->item(row,0)->data(Qt::UserRole).toString()==id){table->selectRow(row);return;}QFAIL("Plugin missing from center");}
    void chooseOperation(QuantPluginWidget& widget,const QString& id){auto operations=widget.findChild<QComboBox*>("pluginOperation");for(int i=0;i<operations->count();++i)if(operations->itemData(i).toJsonObject().value("id")==id){operations->setCurrentIndex(i);return;}QFAIL("Operation missing");}
private slots:
    void initTestCase(){
        packages_=qEnvironmentVariable("WEBSTOCK_CENTER_PACKAGES");source_=qEnvironmentVariable("WEBSTOCK_CENTER_SOURCE_ROOT");output_=qEnvironmentVariable("WEBSTOCK_CENTER_OUTPUT");
        if(packages_.isEmpty()||source_.isEmpty())QSKIP("Set real local packages and read-only archive source for center integration");
        auto catalog=object(read(source_+"/catalog.json"));for(auto v:catalog.value("plugins").toArray()){auto p=v.toObject();runtimes_[p.value("id").toString()]=p.value("runtimePath");}
        if(!output_.isEmpty())QDir().mkpath(output_);
#ifdef Q_OS_WIN
        auto font=QFontDatabase::addApplicationFont("C:/Windows/Fonts/msyh.ttc");if(font>=0)qApp->setFont(QFont(QFontDatabase::applicationFontFamilies(font).first(),10));
#endif
    }
    void centerInstallDisableUninstallReinstallAndCalendar(){
        QTemporaryDir dir;auto root=dir.filePath("quant-plugins");defaults(root);Repository repo(root);auto archived=copyArchive(root,"org.webstock.akshare");QVERIFY(!archived.isEmpty());
        QuantPluginCenter center(root,nullptr,packages_);center.resize(1320,850);center.show();
        auto table=center.findChild<QTableWidget*>("pluginCatalog");auto shortcuts=center.findChild<QListWidget*>("pluginShortcuts");
        QCOMPARE(table->rowCount(),33);QCOMPARE(shortcuts->count(),0);select(center,"org.webstock.akshare");
        auto installButton=center.findChild<QPushButton*>("pluginCenterInstall");QVERIFY(installButton->isEnabled());installButton->click();
        QCOMPARE(repo.plugins().size(),1);QCOMPARE(shortcuts->count(),1);QCOMPARE(repo.plugin("org.webstock.akshare").value("runtimePath"),runtimes_.value("org.webstock.akshare"));screenshot(center,"01-plugin-center");
        auto toggle=center.findChild<QPushButton*>("pluginCenterToggle");toggle->click();QCOMPARE(shortcuts->count(),0);QVERIFY(!center.findChild<QPushButton*>("pluginCenterOpen")->isEnabled());toggle->click();QCOMPARE(shortcuts->count(),1);
        center.findChild<QPushButton*>("pluginCenterOpen")->click();auto widget=center.findChild<QuantPluginWidget*>();QVERIFY(widget&&widget->isVisible());
        QVERIFY(!widget->findChild<QLineEdit*>("pluginRuntime")->isVisible());QVERIFY(!widget->findChild<QComboBox*>("pluginOperation")->isVisible());
        auto start=widget->findChild<QDateEdit*>("pluginParam_startDate"),end=widget->findChild<QDateEdit*>("pluginParam_endDate");QVERIFY(start&&end);QVERIFY(start->calendarPopup()&&end->calendarPopup());
        auto run=widget->findChild<QPushButton*>("pluginRun");QCOMPARE(run->text(),QString("补齐缺失行情"));QVERIFY(run->isEnabled());
        auto symbol=widget->findChild<QLineEdit*>("pluginParam_symbol");symbol->setText("123");QVERIFY(!run->isEnabled());symbol->setText("000001");
        end->setDate(QDate(2020,1,1));start->setDate(QDate(2021,1,1));QVERIFY(!run->isEnabled());widget->findChild<QPushButton*>("pluginRange3")->click();QVERIFY(run->isEnabled());QCOMPARE(start->date(),end->date().addYears(-3));QCOMPARE(end->date(),quantPluginUi::today().addDays(-1));
        auto adjustment=widget->findChild<QComboBox*>("pluginParam_adjustment");QCOMPARE(adjustment->itemText(1),QString("前复权"));adjustment->setCurrentIndex(1);QVERIFY(widget->findChild<QLabel*>("pluginAdjustmentHelp")->text().contains("历史可见性偏差"));
        QVERIFY(widget->findChild<QLabel*>("pluginRequestSummary")->text().contains("将联网"));screenshot(*widget->window(),"02-market-form");
        QTest::mouseClick(start,Qt::LeftButton,Qt::NoModifier,QPoint(start->width()-10,start->height()/2));QTRY_VERIFY(start->calendarWidget()->isVisible());screenshot(*start->calendarWidget(),"03-calendar");QTest::keyClick(start->calendarWidget(),Qt::Key_Escape);
        QPointer<QWidget> business=widget->window();business->close();QTRY_VERIFY(!business);
        center.findChild<QPushButton*>("pluginCenterUninstall")->click();QCOMPARE(repo.plugins().size(),0);QCOMPARE(shortcuts->count(),0);QVERIFY(!center.findChild<QPushButton*>("pluginCenterOpen")->isEnabled());
        Job reader(root);QVERIFY(!reader.reopen(archived).value("result").toObject().isEmpty());QVERIFY(center.findChild<QPushButton*>("pluginCenterHistory")->isEnabled());screenshot(center,"04-uninstalled-history-retained");
        center.findChild<QPushButton*>("pluginCenterHistory")->click();auto historyWidget=center.findChild<QuantPluginWidget*>();QVERIFY(historyWidget);auto history=historyWidget->findChild<QListWidget*>("pluginHistory");QCOMPARE(history->count(),1);
        QTest::mouseClick(history->viewport(),Qt::LeftButton,Qt::NoModifier,history->visualItemRect(history->item(0)).center());QVERIFY(historyWidget->findChild<QLabel*>("pluginMarketSummary")->text().contains("非本次联网获取"));
        QPointer<QWidget> archiveWindow=historyWidget->window();archiveWindow->close();QTRY_VERIFY(!archiveWindow);
        QVERIFY(QFile::remove(root+"/runtime-defaults.json"));installButton->click();QCOMPARE(shortcuts->count(),1);QCOMPARE(repo.plugin("org.webstock.akshare").value("runtimePath"),runtimes_.value("org.webstock.akshare"));
        QCOMPARE(reader.savedMarketData().size(),1); // Uninstall/reinstall did not erase or duplicate data.
        if(!output_.isEmpty())write(output_+"/lifecycle.json",QJsonObject{{"packageCount",33},{"realUninstallReinstall",true},{"shortcutRemoved",true},{"historyRetained",true},{"runtimeRestored",true},{"calendarPopup",true},{"isolatedRoot",root}});
    }
    void savedHistoryToIndicatorAndBacktest(){
        QTemporaryDir dir;auto root=dir.filePath("quant-plugins");defaults(root);Repository repo(root);for(auto id:{"org.webstock.akshare","org.webstock.talib","org.webstock.backtesting-py"})install(repo,id);
        auto archived=copyArchive(root,"org.webstock.akshare");QVERIFY(!archived.isEmpty());auto unrelated=copyArchive(root,"org.webstock.bt");QVERIFY(!unrelated.isEmpty());Job reader(root);
        QuantPluginWidget market(root,nullptr,"org.webstock.akshare");market.resize(1320,900);market.show();auto history=market.findChild<QListWidget*>("pluginHistory");QCOMPARE(history->count(),1);
        QTest::mouseClick(history->viewport(),Qt::LeftButton,Qt::NoModifier,history->visualItemRect(history->item(0)).center());auto summary=market.findChild<QLabel*>("pluginMarketSummary");QVERIFY(summary);QVERIFY(summary->text().contains("请求区间")&&summary->text().contains("实际返回")&&summary->text().contains("243 根已完成K线"));
        QVERIFY(market.findChild<QWidget*>("pluginPricePlot"));QVERIFY(market.findChild<QWidget*>("pluginVolumePlot"));QCOMPARE(market.findChild<QTableView*>("pluginMarketTable")->model()->rowCount(),243);screenshot(market,"05-saved-real-history");
        auto input=reader.marketDataInput(archived);auto original=reader.reopen(archived).value("result").toObject();QCOMPARE(hash(read(input.value("path").toString())),original.value("generatedData").toObject().value("sha256").toString());
        if(!output_.isEmpty())write(output_+"/000001-2020-saved-history.wsresult",reader.exportResult(archived));
        QJsonArray calculations;
        for(auto id:{"org.webstock.talib","org.webstock.backtesting-py"}){
            QuantPluginWidget consumer(root,nullptr,id);consumer.resize(1320,900);consumer.show();if(QString(id)=="org.webstock.talib")chooseOperation(consumer,"rsi");consumer.useSavedData(archived);
            auto picker=consumer.findChild<QLabel*>("pluginDatasetSummary");QVERIFY(picker&&picker->text().contains("000001")&&picker->text().contains("不复权")&&picker->text().contains("东方财富"));
            auto count=reader.records().size();consumer.findChild<QPushButton*>("pluginRun")->click();QTRY_VERIFY_WITH_TIMEOUT(!consumer.isRunning()&&reader.records().size()==count+1,30000);
            QJsonObject record;for(auto v:reader.records())if(v.toObject().value("pluginId")==id)record=v.toObject();QCOMPARE(record.value("status").toString(),QString("completed"));
            auto result=reader.reopen(record.value("runId").toString()).value("result").toObject();QCOMPARE(result.value("inputSha256"),original.value("generatedData").toObject().value("sha256"));
            QCOMPARE(result.value("dataPolicy").toObject().value("archiveRunId").toString(),archived);QCOMPARE(result.value("dataPolicy").toObject().value("dataset").toObject().value("symbol").toString(),QString("000001"));
            calculations.append(QJsonObject{{"pluginId",id},{"runId",record.value("runId")},{"status",record.value("status")},{"inputSha256",result.value("inputSha256")}});screenshot(consumer,QString(id)=="org.webstock.talib"?"06-saved-data-rsi":"07-saved-data-backtest");
            if(!output_.isEmpty())write(output_+"/"+QString(id)+"-saved-input.wsresult",reader.exportResult(record.value("runId").toString()));
        }
        write(input.value("path").toString(),QByteArray("tampered"));QVERIFY_EXCEPTION_THROWN(reader.marketDataInput(archived),std::runtime_error);
        if(!output_.isEmpty())write(output_+"/saved-data-flow.json",QJsonObject{{"sample","previously saved real 000001 / 2020 daily data, not a new network fetch"},{"bars",243},{"historyFiltered",true},{"tamperRejected",true},{"calculations",calculations}});
    }
    void realOnlineRequestAndCancellation(){
        if(!qEnvironmentVariableIsSet("WEBSTOCK_CENTER_LIVE"))QSKIP("Opt-in explicit real online request");
        QTemporaryDir dir;auto root=dir.filePath("quant-plugins");defaults(root);Repository repo(root);install(repo,"org.webstock.akshare");Job reader(root);
        QuantPluginWidget widget(root,nullptr,"org.webstock.akshare");widget.resize(1320,900);widget.show();widget.findChild<QDateEdit*>("pluginParam_startDate")->setDate(QDate(2020,1,1));widget.findChild<QDateEdit*>("pluginParam_endDate")->setDate(QDate(2020,12,31));
        widget.findChild<QPushButton*>("pluginRun")->click();QVERIFY(widget.isRunning());QVERIFY(widget.findChild<QPushButton*>("pluginCancel")->isEnabled());screenshot(widget,"08-online-running");
        QTRY_VERIFY_WITH_TIMEOUT(!widget.isRunning(),90000);QCOMPARE(reader.records().size(),1);auto record=reader.records().first().toObject();auto state=record.value("status").toString();QVERIFY(state=="failed"||state=="completed");
        if(state=="failed"){
            QVERIFY(!QFileInfo::exists(root+"/jobs/"+record.value("runId").toString()+"/result.json"));auto reason=widget.findChild<QLabel*>("pluginFailureReason");QVERIFY(reason&&!reason->text().isEmpty());auto retry=widget.findChild<QPushButton*>("pluginRetry");QVERIFY(retry&&retry->isEnabled());screenshot(widget,"09-online-failure");retry->click();
        }else{QVERIFY(widget.findChild<QLabel*>("pluginMarketSummary")->text().contains("本次更新已完成"));screenshot(widget,"09-online-success");widget.findChild<QPushButton*>("pluginRefreshMarket")->click();}
        QVERIFY(widget.isRunning());widget.findChild<QPushButton*>("pluginCancel")->click();QTRY_VERIFY_WITH_TIMEOUT(!widget.isRunning(),10000);
        bool cancelled=false;for(auto v:reader.records())if(v.toObject().value("status")=="cancelled")cancelled=true;QVERIFY(cancelled);
        if(!output_.isEmpty()){record["isolatedRoot"]=root;record["realNetworkRequest"]=true;record["retryCancelled"]=true;write(output_+"/live-request.json",record);}
    }
};
QTEST_MAIN(PluginCenterTests)
#include "quant_plugin_center_tests.moc"
