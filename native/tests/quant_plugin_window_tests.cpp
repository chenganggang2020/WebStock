#include <QtTest>
#include <QtWidgets>
#include "window.hpp"
#include "quant_research_page.hpp"
#include "quant_plugin_widget.hpp"
#include "quant_plugin_center.hpp"

class PluginWindowTests:public QObject {
    Q_OBJECT
private slots:
    void initTestCase(){
#ifdef Q_OS_WIN
        auto id=QFontDatabase::addApplicationFont("C:/Windows/Fonts/msyh.ttc");
        if(id>=0)qApp->setFont(QFont(QFontDatabase::applicationFontFamilies(id).first(),10));
#endif
    }
    void actualWindowEntryAndExecution(){
        auto python=qEnvironmentVariable("WEBSTOCK_TEST_PYTHON"),package=qEnvironmentVariable("WEBSTOCK_TEST_PACKAGE"),csv=qEnvironmentVariable("WEBSTOCK_TEST_CSV");
        if(python.isEmpty()||package.isEmpty()||csv.isEmpty())QSKIP("Real plugin integration fixture paths required");
        const auto requested=qEnvironmentVariable("WEBSTOCK_TEST_OPERATION");
        const auto waitMs=qBound(15000,qEnvironmentVariableIntValue("WEBSTOCK_TEST_WAIT_MS"),600000);
        const auto parameterFile=qEnvironmentVariable("WEBSTOCK_TEST_PARAMETERS");
        for(auto layout:QStringList{"quotes","classic","focus"}){
            QTemporaryDir dir;QSettings settings(dir.filePath("review.ini"),QSettings::IniFormat);settings.sync();
            auto root=dir.filePath("quant-plugins");quantPlugin::Repository repository(root);
            auto installed=repository.install(quantPlugin::read(package));repository.configure(installed.value("id").toString(),python,true);
            if(!parameterFile.isEmpty())repository.rememberParameters(installed.value("id").toString(),requested,quantPlugin::object(quantPlugin::read(parameterFile)));
            Window window(true,settings.fileName(),dir.path());window.resize(1500,950);window.show();window.setLayoutMode(layout);
            // The current application intentionally redirects legacy focus to classic.
            const auto expectedLayout=layout=="quotes"?QString("quotes"):QString("classic");
            QCOMPARE(window.layoutMode(),expectedLayout);
            auto research=window.findChild<QPushButton*>("workspace研究");QVERIFY(research);research->click();
            auto quant=window.findChild<QPushButton*>("researchOpenQuant");QVERIFY(quant);quant->click();
            auto page=dynamic_cast<QuantResearchPage*>(window.findChild<QWidget*>("quantResearchPage"));QVERIFY(page);
            QTRY_VERIFY_WITH_TIMEOUT(page->property("quantSnapshotReady").toBool(),15000);
            QPushButton* entry=nullptr;for(auto b:page->findChildren<QPushButton*>())if(b->text()=="插件中心")entry=b;
            QVERIFY(entry);QTest::mouseClick(entry,Qt::LeftButton);
            auto center=window.findChild<QuantPluginCenter*>();QVERIFY(center&&center->isVisible());
            auto catalog=center->findChild<QTableWidget*>("pluginCatalog");
            for(int row=0;row<catalog->rowCount();++row)if(catalog->item(row,0)->data(Qt::UserRole).toString()==installed.value("id").toString())catalog->selectRow(row);
            QTest::mouseClick(center->findChild<QPushButton*>("pluginCenterOpen"),Qt::LeftButton);
            auto widget=dynamic_cast<QuantPluginWidget*>(window.findChild<QWidget*>("quantPluginWidget"));QVERIFY(widget&&widget->isVisible());
            auto operations=widget->findChild<QComboBox*>("pluginOperation");QVERIFY(operations);
            bool selected=false;
            for(int i=0;i<operations->count();++i)if(operations->itemData(i).toJsonObject().value("id")== (requested.isEmpty()?QString("rsi"):requested)){operations->setCurrentIndex(i);selected=true;}
            if(!requested.isEmpty())QVERIFY2(selected,"Requested operation is absent from installed package");
            widget->findChild<QLineEdit*>("pluginInput")->setText(csv);widget->findChild<QCheckBox*>("pluginClosedBars")->setChecked(true);
            QTest::mouseClick(widget->findChild<QPushButton*>("pluginRun"),Qt::LeftButton);
            quantPlugin::Job verifier(root);
            const QStringList terminalStates{"completed","failed","cancelled","timed-out"};
            QTRY_VERIFY_WITH_TIMEOUT(!verifier.records().isEmpty()&&terminalStates.contains(verifier.records()[0].toObject().value("status").toString()),waitMs);
            QCOMPARE(verifier.records().size(),1);auto record=verifier.records()[0].toObject();
            if(record.value("status")!="completed"){
                const auto output=qEnvironmentVariable("WEBSTOCK_TEST_SCREENSHOT");
                if(!output.isEmpty()){QCoreApplication::processEvents();widget->window()->grab().save(output);}
                QFAIL(qPrintable(QString::fromUtf8(QJsonDocument(record).toJson(QJsonDocument::Compact))));
            }
            auto tabs=widget->findChild<QTabWidget*>("pluginResults");QTRY_VERIFY_WITH_TIMEOUT(tabs->count()>=2,15000);
            if(qEnvironmentVariableIsSet("WEBSTOCK_EXPECT_OBSOLETE_HIKYUU")){
                auto caution=widget->findChild<QLabel*>("pluginHistoricalCaution");QVERIFY(caution&&caution->text().contains("日期转换错误"));
            }else QVERIFY(!widget->findChild<QLabel*>("pluginHistoricalCaution"));
            if(requested=="turnover-cost-model")QVERIFY(widget->findChild<QWidget*>("pluginCostProfile"));
            QCOMPARE(record.value("status").toString(),QString("completed"));
            auto output=qEnvironmentVariable("WEBSTOCK_TEST_SCREENSHOT");if(!output.isEmpty()&&layout=="classic"){
                auto requestedTab=qEnvironmentVariable("WEBSTOCK_TEST_RESULT_TAB");
                if(!requestedTab.isEmpty()){bool valid=false;auto index=requestedTab.toInt(&valid);QVERIFY(valid&&index>=0&&index<tabs->count());tabs->setCurrentIndex(index);}
                QCoreApplication::processEvents();
                QVERIFY(widget->window()->grab().save(output));
            }
            auto dialog=qobject_cast<QDialog*>(widget->window());QVERIFY(dialog);QPointer<QDialog> guarded(dialog);dialog->close();QTRY_VERIFY(!guarded);
            center->findChild<QPushButton*>("pluginCenterOpen")->click();auto reopened=dynamic_cast<QuantPluginWidget*>(window.findChild<QWidget*>("quantPluginWidget"));QVERIFY(reopened);
            auto history=reopened->findChild<QListWidget*>("pluginHistory");QCOMPARE(history->count(),1);
            QTest::mouseClick(history->viewport(),Qt::LeftButton,Qt::NoModifier,history->visualItemRect(history->item(0)).center());
            QTRY_VERIFY(reopened->findChild<QTabWidget*>("pluginResults")->count()>=2);
            QCOMPARE(verifier.records().size(),1);QCOMPARE(window.layoutMode(),expectedLayout);
        }
    }
    void actualCenterWithAllPackagesAndSavedMarket(){
        const auto packages=qEnvironmentVariable("WEBSTOCK_CENTER_PACKAGES"),source=qEnvironmentVariable("WEBSTOCK_CENTER_SOURCE_ROOT"),output=qEnvironmentVariable("WEBSTOCK_CENTER_OUTPUT");
        if(packages.isEmpty()||source.isEmpty()||output.isEmpty())QSKIP("Set full center fixtures and saved archive output");
        QTemporaryDir dir;auto root=dir.filePath("quant-plugins");quantPlugin::Repository repository(root);
        const auto catalog=quantPlugin::object(quantPlugin::read(source+"/catalog.json")).value("plugins").toArray();
        for(auto v:catalog){auto p=v.toObject();repository.install(quantPlugin::read(packages+"/"+p.value("id").toString()+"-"+p.value("version").toString()+".wspkg"));repository.configure(p.value("id").toString(),p.value("runtimePath").toString(),true);}
        quantPlugin::Job archive(root);archive.importResult(quantPlugin::read(output+"/000001-2020-saved-history.wsresult",68*1024*1024));
        QSettings settings(dir.filePath("review.ini"),QSettings::IniFormat);settings.sync();Window window(true,settings.fileName(),dir.path());window.resize(1500,950);window.show();
        window.findChild<QPushButton*>("workspace研究")->click();window.findChild<QPushButton*>("researchOpenQuant")->click();auto page=window.findChild<QWidget*>("quantResearchPage");QVERIFY(page);QTRY_VERIFY_WITH_TIMEOUT(page->property("quantSnapshotReady").toBool(),15000);
        QPushButton* entry=nullptr;for(auto b:page->findChildren<QPushButton*>())if(b->text()=="插件中心")entry=b;QVERIFY(entry);entry->click();auto center=window.findChild<QuantPluginCenter*>();QVERIFY(center);
        auto table=center->findChild<QTableWidget*>("pluginCatalog");QCOMPARE(table->rowCount(),33);QCOMPARE(center->findChild<QListWidget*>("pluginShortcuts")->count(),33);
        for(int row=0;row<table->rowCount();++row)if(table->item(row,0)->data(Qt::UserRole).toString()=="org.webstock.akshare")table->selectRow(row);
        QCoreApplication::processEvents();QVERIFY(center->window()->grab().save(output+"/11-stock-plugin-center-dark.png"));center->findChild<QPushButton*>("pluginCenterOpen")->click();auto market=center->findChild<QuantPluginWidget*>();QVERIFY(market);
        auto history=market->findChild<QListWidget*>("pluginHistory");QCOMPARE(history->count(),1);QTest::mouseClick(history->viewport(),Qt::LeftButton,Qt::NoModifier,history->visualItemRect(history->item(0)).center());QCoreApplication::processEvents();QVERIFY(market->window()->grab().save(output+"/12-stock-market-dark.png"));
        auto date=market->findChild<QDateEdit*>("pluginParam_startDate");QTest::mouseClick(date,Qt::LeftButton,Qt::NoModifier,QPoint(date->width()-10,date->height()/2));QTRY_VERIFY(date->calendarWidget()->isVisible());QVERIFY(date->calendarWidget()->grab().save(output+"/13-stock-calendar-dark.png"));QTest::keyClick(date->calendarWidget(),Qt::Key_Escape);
        auto use=market->findChild<QPushButton*>("pluginUseMarketData");auto consumers=market->findChild<QComboBox*>("pluginDataConsumer");consumers->setCurrentIndex(consumers->findData("org.webstock.talib"));QVERIFY(use->isEnabled());use->click();
        QuantPluginWidget* target=nullptr;for(auto widget:center->findChildren<QuantPluginWidget*>())if(widget->property("pluginId")=="org.webstock.talib")target=widget;QVERIFY(target);QVERIFY(target->findChild<QComboBox*>("pluginDataset")->currentText().contains("000001"));QVERIFY(!target->isRunning());
    }
};
QTEST_MAIN(PluginWindowTests)
#include "quant_plugin_window_tests.moc"
