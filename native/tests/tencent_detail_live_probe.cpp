#include "market_feed.hpp"
#include <QCoreApplication>
#include <QTemporaryDir>
#include <QJsonDocument>
#include <QFile>
#include <QTimer>
#include <QElapsedTimer>
#include <QThreadPool>

int main(int argc,char** argv){
 QCoreApplication app(argc,argv);QTemporaryDir dir;MarketFeed feed(dir.path(),nullptr,nullptr,false);
 const QStringList ids{"SZ:stock:000977","SZ:stock:000977","SZ:stock:000977","SZ:index:399001","SZ:index:399001","SH:stock:600000","SH:index:000001"};
 QJsonArray results;int index=0,seconds=5;QString current;bool collecting=false;QElapsedTimer heartbeat,elapsed;qint64 maxGap=0;
 heartbeat.start();QTimer pulse;pulse.setInterval(10);QObject::connect(&pulse,&QTimer::timeout,&app,[&]{maxGap=qMax(maxGap,heartbeat.restart());});pulse.start();
 auto save=[&]{QFile file(QString(TENCENT_OUTPUT)+"/live-feed.json");if(file.open(QIODevice::WriteOnly))file.write(QJsonDocument(QJsonObject{{"checkedAt",QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},{"productionDataTouched",false},{"maxGuiHeartbeatGapMs",double(maxGap)},{"results",results}}).toJson());};
 std::function<void()> next=[&]{
  if(index>=ids.size()){save();app.quit();return;}current=ids[index];seconds=index==2?30:5;++index;
  feed.observe({{"id",current},{"symbol",current.section(':',0,0).toLower()+current.section(':',2)},{"name",current}});
  collecting=true;elapsed.restart();feed.sample(current,seconds,true);
 };
 QTimer check;check.setInterval(40);QObject::connect(&check,&QTimer::timeout,&app,[&]{
  if(!collecting)return;QJsonObject item;for(auto value:feed.instruments)if(value.toObject()["id"]==current)item=value.toObject();
  const auto status=item["samplingStatus"].toString();if(status.isEmpty()||status.startsWith("正在"))return;if(!feed.persistenceStats()["idle"].toBool())return;
  const auto meta=item[QString("minute%1sMeta").arg(seconds)].toObject();auto rows=meta["rows"].toArray();QJsonObject first,last;int valid=0;
  for(auto value:rows){auto row=value.toObject();if(row["valid"].toBool()){if(first.isEmpty())first=row;last=row;++valid;}}
  auto evidence=meta;evidence.remove("rows");evidence.remove("detailSnapshot");
  results.append(QJsonObject{{"id",current},{"seconds",seconds},{"elapsedMs",double(elapsed.elapsed())},{"status",status},{"axisSlots",rows.size()},{"validSlots",valid},{"first",first},{"last",last},{"meta",evidence},{"lastAttempt",item["detailAttempt"]}});
  collecting=false;save();QTimer::singleShot(100,&app,next);
 });check.start();QTimer::singleShot(0,&app,next);QTimer::singleShot(150000,&app,[&]{save();app.exit(2);});int code=app.exec();feed.stopPersistence();QThreadPool::globalInstance()->waitForDone();return code;
}
