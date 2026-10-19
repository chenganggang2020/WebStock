#include <QtTest>
#include <QTemporaryDir>
#include <QCryptographicHash>
#include "legacy_archive_page.hpp"
class LegacyArchiveTests:public QObject {
 Q_OBJECT
private slots:
 void archiveIsReadOnlyAndComplete(){
  QTemporaryDir dir;const auto path=dir.filePath("legacy.sqlite");
  {auto db=QSqlDatabase::addDatabase("QSQLITE","fixture");db.setDatabaseName(path);QVERIFY(db.open());QSqlQuery q(db);
   QVERIFY(q.exec("CREATE TABLE expert_comments(id INTEGER PRIMARY KEY,text TEXT,cookie TEXT)"));
   q.prepare("INSERT INTO expert_comments VALUES(?,?,?)");q.addBindValue(1);q.addBindValue(QString(90000,'a')+"完整尾部");q.addBindValue("secret-not-visible");QVERIFY(q.exec());
   QVERIFY(q.exec("INSERT INTO expert_comments VALUES(2,'second','secret')"));db.close();}
  QSqlDatabase::removeDatabase("fixture");
  auto hash=[&]{QFile f(path);if(!f.open(QIODevice::ReadOnly))return QByteArray{};return QCryptographicHash::hash(f.readAll(),QCryptographicHash::Sha256);};const auto before=hash();
  QCOMPARE(legacyArchive::tables(path),QStringList{"expert_comments"});
  const auto row=legacyArchive::row(path,"expert_comments",0);QVERIFY(row.contains("完整尾部"));QVERIFY(!row.contains("secret-not-visible"));QVERIFY(row.contains("未展示敏感字段"));
  QVERIFY(legacyArchive::row(path,"expert_comments",1).contains("second"));QVERIFY(legacyArchive::row(path,"expert_comments",2).isEmpty());
  QVERIFY_EXCEPTION_THROWN(legacyArchive::row(path,"expert_comments;DROP TABLE expert_comments",0),std::runtime_error);
  QVERIFY_EXCEPTION_THROWN(legacyArchive::tables(dir.filePath("missing.sqlite")),std::runtime_error);QVERIFY(!QFileInfo::exists(dir.filePath("missing.sqlite")));
  QCOMPARE(hash(),before);
  legacyArchive::Page page(path);page.show();QVERIFY(QTest::qWaitForWindowExposed(&page));
  QTRY_VERIFY_WITH_TIMEOUT(page.findChild<QPlainTextEdit*>("legacyArchiveText")->toPlainText().contains("完整尾部"),5000);
 }
};
QTEST_MAIN(LegacyArchiveTests)
#include "legacy_archive_tests.moc"
