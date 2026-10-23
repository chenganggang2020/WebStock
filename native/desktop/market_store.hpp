#pragma once
#include <QJsonObject>
#include <QString>
#include <QStringList>
// Each operation owns its SQLite connection on the calling thread.
class MarketStore {
 public:
  struct SaveInfo {
    bool superseded = false;
    int historyReads = 0;
    int historyRows = 0;
  };
  explicit MarketStore(QString file) : file(std::move(file)) {}
  bool contains(const QString &key) const;
  QJsonObject read(const QString &key) const;
  QJsonObject save(const QString &key, const QJsonObject &incoming,
                   SaveInfo *info = nullptr) const;
  QStringList keys(const QString &prefix) const;
  // Read-only, short-lock snapshot. Call off the GUI thread; never creates a DB.
  QJsonObject capitalArchive(const QString &id, const QString &date) const;

 private:
  QString file;
};
