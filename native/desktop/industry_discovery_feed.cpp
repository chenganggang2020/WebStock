#include "industry_discovery_feed.hpp"
namespace industryDiscovery {
Feed::Feed(QObject* parent,QNetworkAccessManager* manager):QObject(parent),peer(nullptr,manager){connect(&peer,&sectorWatch::Feed::finished,this,[this](QJsonObject q,QJsonObject s,QString error){if(!running||q!=input)return;running=false;emit finished(q,s,error);});}
bool Feed::start(const QJsonObject& q){sectorWatch::queryKey(q);if(running)return false;input=q;running=true;if(!peer.start(q)){running=false;return false;}return true;}
void Feed::cancel(){running=false;peer.cancel();}
}
