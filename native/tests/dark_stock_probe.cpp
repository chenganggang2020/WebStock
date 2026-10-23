#include "dark_stock.hpp"
#include "dark_history_backfill.hpp"
#include <QCoreApplication>
#include <QFile>
#include <QJsonDocument>
#include <QSaveFile>
// Explicit opt-in only: never registered in deterministic CTest.
int main(int argc, char **argv) {
  QCoreApplication app(argc, argv);
  auto args = app.arguments();
  if(args.size()==5&&args[1]=="--history-range"){
    try{auto receipt=darkHistory::backfill(args[4],QDate::fromString(args[2],Qt::ISODate),QDate::fromString(args[3],Qt::ISODate),{},[](QString text){puts(text.toUtf8().constData());fflush(stdout);});puts(QJsonDocument(receipt).toJson(QJsonDocument::Compact).constData());return receipt["failed"].toInt()==0&&!receipt["cancelled"].toBool()?0:1;}
    catch(const std::exception& e){puts(e.what());return 1;}
  }
  if (args.size() != 4 ||
      (args[1] != "--one-full-scan" && args[1] != "--replay-pages"))
    return 2;
  const bool replay = args[1] == "--replay-pages";
  QJsonObject result;
  try {
    darkStock::Store store(args[3] + (replay ? "/verified-cache" : ""));
    QJsonObject s;
    if (replay) {
      auto read = [](QString path) {
        QFile f(path);
        if (!f.open(QIODevice::ReadOnly))
          throw std::runtime_error("diagnostic file unavailable");
        return QJsonDocument::fromJson(f.readAll()).object();
      };
      const auto manifest = read(args[3] + "/manifest.json");
      darkStock::Assembly scan(args[2], manifest["startedAt"].toString());
      for (auto v : manifest["pages"].toArray()) {
        const auto p = v.toObject();
        const auto part = darkStock::normalize(
            read(args[3] + "/" + p["file"].toString()), args[2],
            p["page"].toInt(), p["receivedAt"].toString());
        scan.append(part, p["elapsedMs"].toInteger());
      }
      s = scan.finish();
      store.save(s);
    } else {
      s = store.refresh(args[2]);
    }
    result = {{"success", true},
              {"scope", "one explicitly requested bounded scan; not continuous "
                        "real-time acceptance"},
              {"tradingDay", s["tradingDay"]},
              {"receivedAt", s["receivedAt"]},
              {"coverage", s["coverage"]},
              {"source", s["source"]}};
    auto loaded = store.read(args[2]);
    result["reopenedRows"] = loaded["rows"].toArray().size();
  } catch (const std::exception &e) {
    result = {{"success", false}, {"error", QString::fromUtf8(e.what())}};
  }
  result["mode"] = replay ? "offline raw-page replay through native validation"
                          : "explicit live full scan";
  QSaveFile out(args[3] +
                (replay ? "/replay-result.json" : "/probe-result.json"));
  if (out.open(QIODevice::WriteOnly)) {
    out.write(QJsonDocument(result).toJson());
    out.commit();
  }
  puts(QJsonDocument(result).toJson(QJsonDocument::Compact).constData());
  return result["success"].toBool() ? 0 : 1;
}
