#pragma once
#include <QByteArray>
#include <QJsonArray>
#include <QJsonObject>
#include <QString>
#include <QUrl>

namespace boardSeries {
inline const QString schema = "native-board-series/v1";
QJsonObject query(const QString& taxonomy, const QString& code,
                  const QString& period = "day", int rawDays = 640,
                  const QString& provider = "eastmoney-public-board");
QJsonObject fromThs(const QJsonArray& daily,const QJsonArray& receipts,const QString& chartCode,
                   const QString& detailHash,const QJsonObject& query,const QString& checkedAt,const QJsonObject& inventory={});
QString key(const QJsonObject& query);
QUrl url(const QJsonObject& query);
QJsonObject parse(const QByteArray& bytes, const QJsonObject& query,
                  const QString& checkedAt);
void validate(const QJsonObject& series);
QJsonObject legacyCatalog(const QByteArray& bytes);

class Cache {
  QString directory;
  QString path(const QJsonObject& query) const;
public:
  explicit Cache(QString ownedDirectory);
  QJsonObject read(const QJsonObject& query) const;
  void save(const QJsonObject& series);
  void failure(const QJsonObject& query, const QString& error,
               const QString& checkedAt);
};
}
