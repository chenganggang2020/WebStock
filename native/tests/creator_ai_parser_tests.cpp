#include <QtTest>
#include "creator_ai_model.hpp"
class CreatorAiParserTests:public QObject {
 Q_OBJECT
private slots:
 void completeUtf8Only_data(){
  QTest::addColumn<QByteArray>("bytes");QTest::addColumn<bool>("accepted");
  QTest::newRow("complete-object")<<QByteArray("{}")<<true;
  QTest::newRow("complete-multibyte")<<QByteArray::fromHex("7b2278223a22e4b8adf09f9880227d")<<true;
  QTest::newRow("dangling-three-byte")<<QByteArray::fromHex("7b7de4")<<false;
  QTest::newRow("dangling-four-byte")<<QByteArray::fromHex("7b7df09f")<<false;
 }
 void completeUtf8Only(){QFETCH(QByteArray,bytes);QFETCH(bool,accepted);bool actual=true;try{creatorAi::parseObject(bytes);}catch(const std::exception&){actual=false;}QCOMPARE(actual,accepted);}
};
QTEST_GUILESS_MAIN(CreatorAiParserTests)
#include "creator_ai_parser_tests.moc"
