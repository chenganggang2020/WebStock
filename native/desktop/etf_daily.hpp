#pragma once
#include <QDateTime>
#include <QJsonArray>
#include <QJsonObject>
namespace etfDaily {
class ScheduleClock;
QString catalogUrl(qint64 trace, qint64 before = 0);
QString articleUrl(const QString &id);
QString contentUrl(const QString &id);
bool allowedUrl(const QString &url, bool image = false);
QDate previousDay(QDate date);
bool knownOpen(QDate date);
QJsonArray catalog(const QJsonObject &data);
QJsonObject article(const QString &html, const QJsonObject &item,
                    const QDateTime &now);
QJsonObject content(const QJsonObject &payload, const QJsonObject &item,
                    const QDateTime &now);
QJsonObject validate(const QJsonObject &report);
class Store {
  QString file;
  QString beginRequest(const QDateTime &now, ScheduleClock *clock);

public:
  explicit Store(QString path) : file(std::move(path)) {}
  QJsonObject state() const;
  QJsonArray history() const;
  QJsonObject read(const QString &id) const;
  bool saveVerifiedHistory(const QJsonObject &report, const QDateTime &now);
  QString begin(const QDateTime &now);
  QString beginScheduled(ScheduleClock &clock, const QDateTime &now);
  void setScheduleEnabled(bool enabled);
  bool finish(const QString &token, const QJsonObject &report,
              const QDateTime &now);
  bool fail(const QString &token, const QString &reason, const QDateTime &now);
  int importReports(const QJsonArray &reports, const QDateTime &now);
};
} // namespace etfDaily
