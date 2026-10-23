#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QSet>
#include <QStringList>
#include <functional>
namespace darkStock {
QString url(const QString &date, int page);
QJsonObject normalize(const QJsonObject &raw, const QString &date, int page,
                      const QString &at);
QJsonObject select(const QJsonObject &snapshot, const QStringList &keys);
void validate(const QJsonObject &snapshot);
class Assembly {
  QString date, start;
  QJsonObject source;
  QJsonArray rows;
  QSet<QString> seen;
  int page = 0, total = -1;
  QString at;

public:
  Assembly(QString date, QString start);
  bool append(const QJsonObject &part, qint64 elapsedMs);
  QJsonObject finish() const;
};
class Store {
  QString directory;

public:
  explicit Store(QString directory);
  QJsonObject read(const QString &date) const;
  QJsonObject latestOnOrBefore(const QString &date) const;
  void save(const QJsonObject &snapshot,
            const std::function<bool()> &cancelled = {}) const;
  qint64 retryAfter(qint64 nowMs) const;
  void attempt(qint64 nowMs) const;
  void failure(qint64 nowMs) const;
  QJsonObject refresh(const QString &date,
                      const std::function<bool()> &cancelled = {},
                      const std::function<void(int, int)> &progress = {}) const;
  QString path() const { return directory; }
};
QJsonObject fetch(const QString &date,
                  const std::function<bool()> &cancelled = {},
                  const std::function<void(int, int)> &progress = {});
} // namespace darkStock
