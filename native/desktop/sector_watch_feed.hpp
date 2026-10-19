#pragma once
#include "sector_watch_model.hpp"
#include <QNetworkAccessManager>
#include <QPointer>
#include <QElapsedTimer>
#include <QTimer>
#include <memory>
class QNetworkReply;
namespace sectorWatch {
class Feed final:public QObject {
 Q_OBJECT
 public:
  explicit Feed(QObject* parent=nullptr,QNetworkAccessManager* transport=nullptr);
  ~Feed() override;
  bool start(const QJsonObject& query);void cancel();bool busy()const{return running;}
 signals:void finished(QJsonObject query,QJsonObject snapshot,QString error);
 private:
  QNetworkAccessManager owned;QNetworkAccessManager* transport;QPointer<QNetworkReply> reply;QTimer deadline;QElapsedTimer elapsed;
  quint64 generation=0;bool running=false;QJsonObject input;QString started;int page=1,total=-1;std::unique_ptr<Assembly> assembly;QByteArray conceptHtml;
  void request(const QString& phase);void receive(const QByteArray& bytes,const QString& phase);void fail(const QString& message);void succeed(const QJsonObject& snapshot);
};
}
