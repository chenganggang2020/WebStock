#include "capital_timeline.hpp"
#include "group_display_name.hpp"
#include "comparison_choice_list.hpp"
#include <QtTest>
class UsabilityWidgets:public QObject {
 Q_OBJECT
private slots:
 void comparisonTextClickAndDrag(){ComparisonChoiceList list;list.resize(240,120);auto* a=new QListWidgetItem("上证指数",&list);auto* b=new QListWidgetItem("科创50",&list);for(auto* item:{a,b}){item->setFlags(item->flags()|Qt::ItemIsUserCheckable);item->setCheckState(Qt::Unchecked);}list.show();QTest::qWait(10);auto p=list.visualItemRect(a).center(),q=list.visualItemRect(b).center();QTest::mouseClick(list.viewport(),Qt::LeftButton,Qt::NoModifier,p);QCOMPARE(a->checkState(),Qt::Checked);QTest::mousePress(list.viewport(),Qt::LeftButton,Qt::NoModifier,p);QTest::mouseMove(list.viewport(),q);QTest::mouseRelease(list.viewport(),Qt::LeftButton,Qt::NoModifier,q);QCOMPARE(b->checkState(),Qt::Unchecked);}
 void sourceNamesStayUntouched(){const QString source="同花顺 · 00__每日荐股_0908";QCOMPARE(groupDisplayName(source,"local:ths:owner:151"),QString("00 每日荐股 0908"));QCOMPARE(source,QString("同花顺 · 00__每日荐股_0908"));QCOMPARE(groupDisplayName("当前持仓","local:account"),QString("当前持仓"));QCOMPARE(groupDisplayName("同花顺 · 全部自选","local:ths:owner:main"),QString("导入自选"));}
 void capitalTimelinePreservesMissingDatesAndAllAmounts(){CapitalTimeline chart;QJsonArray rows;for(int i=0;i<122;++i)rows.append(QJsonObject{{"label",QDate(2026,1,1).addDays(i*2).toString(Qt::ISODate)},{"mainNet",i==5?QJsonValue(QJsonValue::Null):QJsonValue((i-61)*10001.0)}});const auto before=rows;chart.setRows(rows);chart.resize(chart.minimumWidth(),300);chart.show();QVERIFY(!chart.grab().isNull());QCOMPARE(chart.sourceRows(),before);QCOMPARE(chart.sourceRows().size(),122);QVERIFY(chart.sourceRows()[5].toObject()["mainNet"].isNull());chart.setMetric("superNet","超大单");QVERIFY(!chart.grab().isNull());QCOMPARE(chart.sourceRows(),before);}
};
QTEST_MAIN(UsabilityWidgets)
#include "market_usability_widget_tests.moc"
