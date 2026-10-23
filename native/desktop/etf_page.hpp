#pragma once
#include "etf_daily.hpp"
#include "etf_schedule.hpp"
#include <QNetworkAccessManager>
#include <QPointer>
#include <QWidget>
#include <functional>
#include <memory>
class QListWidget;
class QTableWidget;
class QLabel;
class QPlainTextEdit;
class QPushButton;
class QNetworkReply;
class QCheckBox;
class EtfPage final : public QWidget {
  Q_OBJECT
public:
  EtfPage(QString file, bool networkEnabled, QWidget *parent = nullptr);
  ~EtfPage() override;
  void load();
  void refreshSource();
  void cancel();
  void previewImport(const QString &file);
  void confirmImport();
  void exportFile(const QString &file);
signals:
  void quoteRequested(const QString &id);

private:
  etfDaily::Store store;
  bool networkEnabled;
  QNetworkAccessManager network;
  QPointer<QNetworkReply> reply;
  quint64 generation = 0;
  QString token;
  etfDaily::ScheduleClock scheduleClock;
  bool scheduledRequest = false;
  bool backfilling = false;
  int historyPages = 0, historyAdded = 0, historySkipped = 0;
  qint64 historyCursor = 0;
  QJsonArray historyQueue;
  QStringList historyErrors;
  QCheckBox *scheduleEnabled;
  QLabel *scheduleState;
  QListWidget *days;
  QTableWidget *buys, *sells;
  QLabel *state, *summary, *dates, *selected;
  QPlainTextEdit *preview;
  QPushButton *refresh, *stop, *confirm, *article, *image;
  QWidget *importActions;
  QJsonArray records, pending;
  QJsonObject report;
  void render();
  void scheduleTick();
  void startSource();
  void nextHistory();
  void finishHistory();
  void fail(const QString &);
  void request(const QString &, int, std::function<void(QByteArray)>, std::function<void(QString)> failure = {});
};
