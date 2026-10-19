#include "navigation_model.hpp"
#include <QtTest>
class NavigationModelTests:public QObject{
 Q_OBJECT
private slots:
 void uniqueCatalog(){QSet<QString> ids;for(const auto&e:navigation::entries()){QVERIFY(!e.id.isEmpty());QVERIFY(!e.page.isEmpty());QVERIFY(!ids.contains(e.id));QVERIFY(navigation::groups().contains(e.group));ids.insert(e.id);}QCOMPARE(navigation::groups().size(),7);for(auto g:navigation::groups())QVERIFY(!navigation::defaults(g).isEmpty());}
 void defaults(){auto state=navigation::normalized({});for(auto g:navigation::groups()){QCOMPARE(navigation::ordered(state,g),navigation::defaults(g));for(auto id:navigation::defaults(g))QVERIFY(!navigation::hidden(state,g,id));}}
 void safeOrderAndHidden(){
  QJsonObject group{{"order",QJsonArray{"globalMarket","bad","globalMarket","funds","home"}},
                    {"hidden",QJsonArray{"home","bad","funds"}}};
  QJsonObject state{{"schema","stock-navigation/v1"},{"groups",QJsonObject{{"主页",group}}}};
  auto clean=navigation::normalized(state);auto ordered=navigation::ordered(clean,"主页");
  QCOMPARE(ordered[0],QString("globalMarket"));QCOMPARE(ordered[1],QString("home"));
  QCOMPARE(ordered.size(),navigation::defaults("主页").size());
  QVERIFY(navigation::hidden(clean,"主页","home"));QVERIFY(!navigation::hidden(clean,"主页","funds"));QVERIFY(!ordered.contains("bad"));
 }
 void unsupportedSchemaDefaults(){QJsonObject invalid{{"schema","future"},{"groups",QJsonObject{{"主页",QJsonObject{{"hidden",QJsonArray{"home"}}}}}}};QVERIFY(!navigation::hidden(navigation::normalized(invalid),"主页","home"));}
};
QTEST_GUILESS_MAIN(NavigationModelTests)
#include "navigation_model_tests.moc"
