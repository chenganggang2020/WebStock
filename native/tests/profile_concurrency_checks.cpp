#include "stock_profile_service.hpp"
#include <QCoreApplication>
#include <QTemporaryDir>
#include <thread>
#include <atomic>
#include <condition_variable>
#include <chrono>
#include <cstdio>
int main(int argc,char**argv){QCoreApplication app(argc,argv);try{
 QFile input(QString::fromLocal8Bit(argv[1]));if(!input.open(QIODevice::ReadOnly))throw std::runtime_error("Fixture missing");auto f=QJsonDocument::fromJson(input.readAll()).object();QString id=f["id"].toString(),at=f["at"].toString();QTemporaryDir root(QString::fromLocal8Bit(argv[2])+"/profile-writers-XXXXXX");if(!root.isValid())throw std::runtime_error("Private output missing");root.setAutoRemove(false);
 auto variant=[&](QString name){auto replies=f["responses"].toObject(),r=replies["CompanySurvey"].toObject(),body=r["body"].toObject();auto rows=body["jbzl"].toArray();auto row=rows[0].toObject();row["ORG_NAME"]=name;rows[0]=row;body["jbzl"]=rows;r["body"]=body;replies["CompanySurvey"]=r;return stockProfile::merge(id,replies,{},at);};
 auto gap=[]{std::this_thread::sleep_for(std::chrono::milliseconds(150));};StockProfileCache first(root.path(),gap),second(root.path(),gap);auto base=variant("original"),one=variant("writer-one"),two=variant("writer-two");first.save(id,base,{},[]{return true;});
 for(int run=0;run<8;++run){first.save(id,base,first.capture(id,at).baseline,[]{return true;});QString before=first.capture(id,at).baseline;std::mutex gate;std::condition_variable cv;int ready=0;bool go=false;std::atomic<int> accepted{0},rejected{0},unexpected{0};std::thread writers[2];StockProfileCache* caches[]={&first,&second};QJsonObject packets[]={one,two};
  for(int n=0;n<2;++n)writers[n]=std::thread([&,n]{int calls=0;try{caches[n]->save(id,packets[n],before,[&]{if(calls++==0){std::unique_lock<std::mutex> lock(gate);++ready;cv.notify_all();if(!cv.wait_for(lock,std::chrono::seconds(5),[&]{return go;}))throw std::runtime_error("Writer gate timeout");}return true;});++accepted;}catch(const std::exception&e){if(QString::fromUtf8(e.what()).contains("缓存已变化"))++rejected;else ++unexpected;}});
  bool both=false;{std::unique_lock<std::mutex> lock(gate);both=cv.wait_for(lock,std::chrono::seconds(5),[&]{return ready==2;});go=true;}cv.notify_all();for(auto&w:writers)w.join();if(!both||accepted!=1||rejected!=1||unexpected!=0)throw std::runtime_error("Same-process instances did not reject exactly one stale writer");auto saved=first.capture(id,at).packet["companyName"].toString();if(saved!="writer-one"&&saved!="writer-two")throw std::runtime_error("Stored packet is not a complete winner");
 }
 auto before=first.capture(id,at).baseline;int ownerCalls=0;bool cancelled=false;try{first.save(id,base,before,[&]{return ++ownerCalls==1;});}catch(...){cancelled=true;}if(!cancelled||first.capture(id,at).baseline!=before)throw std::runtime_error("Late owner cancellation replaced cache");if(!QDir(root.path()).entryList({"*.tmp"},QDir::Files).isEmpty())throw std::runtime_error("Cancelled writer retained temporary file");
 std::puts("{\"checks\":4,\"controlledRuns\":8,\"sameProcessInstancesSerialized\":true,\"staleWriterRejected\":true,\"lateOwnerCancelled\":true,\"noncooperatingExternalAtomicCas\":false}");return 0;
 }catch(const std::exception&e){std::fprintf(stderr,"%s\n",e.what());return 1;}}
