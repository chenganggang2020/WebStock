#include <QtTest>
#include <QtWidgets>
#include "window.hpp"
#include "quant_research_page.hpp"
#include "quant_plugin_widget.hpp"

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
        for(auto layout:QStringList{"quotes","classic","focus"}){
            QTemporaryDir dir;QSettings settings(dir.filePath("review.ini"),QSettings::IniFormat);settings.sync();
            auto root=dir.filePath("quant-plugins");quantPlugin::Repository repository(root);
            auto installed=repository.install(quantPlugin::read(package));repository.configure(installed.value("id").toString(),python,true);
            Window window(true,settings.fileName(),dir.path());window.resize(1500,950);window.show();window.setLayoutMode(layout);
            // The current application intentionally redirects legacy focus to classic.
            const auto expectedLayout=layout=="quotes"?QString("quotes"):QString("classic");
            QCOMPARE(window.layoutMode(),expectedLayout);
            auto research=window.findChild<QPushButton*>("workspace研究");QVERIFY(research);research->click();
            auto quant=window.findChild<QPushButton*>("researchOpenQuant");QVERIFY(quant);quant->click();
            auto page=dynamic_cast<QuantResearchPage*>(window.findChild<QWidget*>("quantResearchPage"));QVERIFY(page);
            QTRY_VERIFY_WITH_TIMEOUT(page->property("quantSnapshotReady").toBool(),15000);
            QPushButton* entry=nullptr;for(auto b:page->findChildren<QPushButton*>())if(b->text()=="量化插件")entry=b;
            QVERIFY(entry);QTest::mouseClick(entry,Qt::LeftButton);
            auto widget=dynamic_cast<QuantPluginWidget*>(window.findChild<QWidget*>("quantPluginWidget"));QVERIFY(widget&&widget->isVisible());
            auto operations=widget->findChild<QComboBox*>("pluginOperation");QVERIFY(operations);
            for(int i=0;i<operations->count();++i)if(operations->itemData(i).toJsonObject().value("id")=="rsi")operations->setCurrentIndex(i);
            widget->findChild<QLineEdit*>("pluginInput")->setText(csv);widget->findChild<QCheckBox*>("pluginClosedBars")->setChecked(true);
            QTest::mouseClick(widget->findChild<QPushButton*>("pluginRun"),Qt::LeftButton);
            auto tabs=widget->findChild<QTabWidget*>("pluginResults");QTRY_VERIFY_WITH_TIMEOUT(tabs->count()>=2,15000);
            quantPlugin::Job verifier(root);QCOMPARE(verifier.records().size(),1);auto record=verifier.records()[0].toObject();
            QCOMPARE(record.value("status").toString(),QString("completed"));
            auto output=qEnvironmentVariable("WEBSTOCK_TEST_SCREENSHOT");if(!output.isEmpty()&&layout=="classic")QVERIFY(widget->window()->grab().save(output));
            auto dialog=qobject_cast<QDialog*>(widget->window());QVERIFY(dialog);QPointer<QDialog> guarded(dialog);dialog->close();QTRY_VERIFY(!guarded);
            entry->click();auto reopened=dynamic_cast<QuantPluginWidget*>(window.findChild<QWidget*>("quantPluginWidget"));QVERIFY(reopened);
            auto history=reopened->findChild<QListWidget*>("pluginHistory");QCOMPARE(history->count(),1);
            QTest::mouseClick(history->viewport(),Qt::LeftButton,Qt::NoModifier,history->visualItemRect(history->item(0)).center());
            QTRY_VERIFY(reopened->findChild<QTabWidget*>("pluginResults")->count()>=2);
            QCOMPARE(verifier.records().size(),1);QCOMPARE(window.layoutMode(),expectedLayout);
        }
    }
};
QTEST_MAIN(PluginWindowTests)
#include "quant_plugin_window_tests.moc"
