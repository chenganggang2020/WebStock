#include <QCommandLineParser>
#include <QCoreApplication>
#include <QSaveFile>
#include <QTextStream>

#include "business_store.hpp"
#include "legacy_data.hpp"
#include "source_history.hpp"
#include "market_data.hpp"
#include "market_store.hpp"
// Explicit local migration aid: never starts collection or opens the source
// writable.
int main(int argc, char **argv) {
  QCoreApplication app(argc, argv);
  QCommandLineParser p;
  p.addHelpOption();
  for (const QString &name : {"source", "export", "apply-business", "before",
                              "funds", "market", "id", "source-history"})
    p.addOption({name, name, "path-or-id"});
  p.process(app);
  auto save = [](QString path, QJsonObject data) {
    QSaveFile f(path);
    auto bytes = QJsonDocument(data).toJson(QJsonDocument::Compact);
    business::require(!path.isEmpty() && f.open(QIODevice::WriteOnly) &&
                          f.write(bytes) == bytes.size() && f.commit(),
                      "文件保存失败");
  };
  try {
    if(p.isSet("source-history")) {
      auto data=legacydata::readSourceHistory(p.value("source-history"));
      business::require(QFileInfo(p.value("export")).absoluteFilePath()!=QFileInfo(p.value("source-history")).absoluteFilePath(),"导出不能覆盖旧数据库");
      sourceHistory::saveNewJson(p.value("export"),data);
      QTextStream(stdout)<<"history:"<<data["runs"].toArray().size()<<"\n";
    }
    if (p.isSet("source")) {
      auto data = legacydata::readBusiness(p.value("source"));
      save(p.value("export"), data);
      if (p.isSet("apply-business")) {
        auto path = p.value("apply-business");
        business::require(
            QFileInfo(path).fileName() == "business-v1.sqlite" &&
                QFileInfo(path).canonicalFilePath() !=
                    QFileInfo(p.value("source")).canonicalFilePath(),
            "仅允许原生业务库目标");
        BusinessStore store(path);
        save(p.value("before"), store.backup());
        store.restore(data);
      }
      for (auto kind : business::kinds())
        QTextStream(stdout)
            << kind << ":" << data[kind].toArray().size() << "\n";
    }
    if (p.isSet("funds")) {
      business::require(
          QFileInfo(p.value("market")).fileName() == "market-v1.sqlite",
          "仅允许原生行情库目标");
      QFile f(p.value("funds"));
      business::require(
          f.open(QIODevice::ReadOnly) && f.size() <= 8 * 1024 * 1024,
          "资金文件不可读");
      auto data = marketdata::legacyCapital(
          QJsonDocument::fromJson(f.readAll()).object(), p.value("id"),
          QDateTime::currentDateTimeUtc());
      auto saved =
          MarketStore(p.value("market"))
              .save(p.value("id") + "-capital@" + data["dataDate"].toString(),
                    data);
      QTextStream(stdout) << "funds:" << saved["rows"].toArray().size()
                          << " date:" << saved["dataDate"].toString()
                          << " saved\n";
    }
  } catch (const std::exception &e) {
    QTextStream(stderr) << e.what() << "\n";
    return 1;
  }
  return 0;
}
