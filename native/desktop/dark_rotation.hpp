#pragma once
#include <QDateTime>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <functional>

namespace darkRotation {
QString add(QString a, QString b);
QString subtract(const QString& a, const QString& b);
QString money(const QJsonValue& cents);
QString sourceKey(const QJsonObject& snapshot);
QJsonObject normalize(const QJsonObject& raw, const QString& date,
                      const QString& scope, int page, const QString& receivedAt);
void validate(const QJsonObject& snapshot);
QJsonObject window(const QJsonArray& snapshots, const QString& code,
                   const QString& field, int minutes);
QString url(const QString& date, const QString& scope, int page);
bool captureAllowed(const QString& date, const QString& start, const QString& end);
QJsonObject analyze(const QJsonArray& snapshots,const QString& field,int minutes,
                    const QString& now,const std::function<bool()>& cancelled = {});
QJsonArray series(const QJsonArray& snapshots,const QString& code,const QString& field);
class Store {
 public:
  explicit Store(QString file):file(std::move(file)) {}
  int save(const QJsonObject& snapshot, const std::function<bool()>& cancelled = {});
  int saveRound(const QJsonArray& snapshots, const std::function<bool()>& cancelled = {});
  int importFile(const QString& path, const std::function<bool()>& cancelled = {});
  QStringList dates() const;
  QJsonArray read(const QString& date,const QString& scope,bool daily) const;
 private:
  QString file;
};
}
