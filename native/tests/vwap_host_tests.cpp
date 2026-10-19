#include <QtTest>
#include <QtWidgets>
#include "window.hpp"
class VwapHostTests:public QObject {
 Q_OBJECT
private slots:
 void controls() {
  for(QString layout:{"classic","quotes","focus"}) {
   QTemporaryDir dir;QString settings=dir.filePath("settings.ini");
   Window w(true,settings,dir.path());w.resize(1600,1000);w.show();w.setLayoutMode(layout);
   auto item=w.instruments[0].toObject();item["dayMeta"]=QJsonObject{{"volumeUnit","shares"},{"adjustment","none"}};
   w.instruments[0]=item;w.loadInstrument(item["id"].toString(),true);
   auto edit=[&](bool accept,QString mode){
    bool found=false;QTimer::singleShot(20,&w,[&]{
     auto* dialog=w.findChild<QDialog*>("parameterDialog");if(!dialog)return;
     auto* enabled=dialog->findChild<QCheckBox*>("vwapEnabled");auto* modes=dialog->findChild<QComboBox*>("vwapMode");
     auto* anchor=dialog->findChild<QComboBox*>("vwapAnchor");auto* buttons=dialog->findChild<QDialogButtonBox*>();
     found=enabled&&modes&&anchor&&buttons;if(!found){dialog->reject();return;}
     enabled->setChecked(true);modes->setCurrentIndex(modes->findData(mode));anchor->setCurrentIndex(anchor->findData("auto"));
     buttons->button(accept?QDialogButtonBox::Ok:QDialogButtonBox::Cancel)->click();
    });w.findChild<QPushButton*>("parameters")->click();return found;
   };
   QVERIFY(edit(false,"hlc3-approx"));QVERIFY(!w.chart->vwapEnabled);
   QVERIFY(edit(true,"legacy-close-approx"));QVERIFY(w.chart->vwapEnabled);QVERIFY(w.referenceChart->vwapEnabled);
   QVERIFY(w.chart->vwapError.isEmpty());QVERIFY(!w.chart->vwapData.values.empty());
   w.showExplanation(w.chart->selected);QVERIFY(w.explanation->toPlainText().contains("VWAP 主图"));
   const auto settingsFile=QSettings(settings,QSettings::IniFormat);QVERIFY(settingsFile.value("vwapEnabled").toBool());
   if(!qEnvironmentVariable("NATIVE_QA_OUTPUT").isEmpty())QVERIFY(w.grab().save(qEnvironmentVariable("NATIVE_QA_OUTPUT")+"/qt-v35-vwap-"+layout+".png"));
   QVERIFY(edit(true,"actual-amount"));QVERIFY(!std::isfinite(w.chart->vwapData.values.back()));
   w.showExplanation(w.chart->selected);QVERIFY(w.explanation->toPlainText().contains("未知"));
   QCOMPARE(w.layoutMode(),layout);
  }
 }
};
QTEST_MAIN(VwapHostTests)
#include "vwap_host_tests.moc"
