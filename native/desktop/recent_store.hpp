#pragma once
#include <QDateTime>
#include <QJsonArray>
#include <QJsonObject>
#include <QString>
#include <functional>

class RecentStore {
 public:
  explicit RecentStore(QString file) : file(std::move(file)) {}
  void recordView(const QJsonObject& instrument,
                  const QDateTime& when = QDateTime::currentDateTimeUtc()) const;
  QJsonArray list(const QString& query = {}, const QString& sort = "last_viewed",
                  int limit = 100) const;
  void updateQuotes(const QJsonArray& instruments) const;
  bool remove(const QString& id) const;
  int clear() const;
  QJsonObject importRows(const QJsonArray& rows) const;
  QJsonObject restoreSnapshot() const;
  QJsonObject previewRestore(const QJsonObject& payload,const QJsonObject& before) const;
  QJsonObject commitRestore(const QJsonObject& preview,std::function<void()> beforeCommit={}) const;
  bool verifyRestore(const QJsonObject& preview,const QJsonObject& receipt,const QJsonObject& after) const;
  static QByteArray csv(const QJsonArray& rows);
  QString filePath() const { return file; }
 private:
  QString file;
};
