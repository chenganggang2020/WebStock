#pragma once
#include "sector_watch_feed.hpp"
namespace industryDiscovery {
// Reuses the frozen native public source adapter; no fallback or background fetch.
class Feed final:public QObject {
 Q_OBJECT
 sectorWatch::Feed peer;bool running=false;QJsonObject input;
 public:explicit Feed(QObject* parent=nullptr,QNetworkAccessManager* transport=nullptr);bool start(const QJsonObject& query);void cancel();bool busy()const{return running;}
 signals:void finished(QJsonObject query,QJsonObject snapshot,QString error);
};
}
