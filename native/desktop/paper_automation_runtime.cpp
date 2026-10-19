#include "paper_automation_runtime.hpp"
#include "paper_automation_model.hpp"
namespace paperAutomation {
namespace {void need(bool ok,const char*why){if(!ok)throw std::runtime_error(why);}}
Runtime::Runtime(QString file,QString id,Host h,QObject*parent,QNetworkAccessManager*fake):QObject(parent),store(std::move(file)),account(std::move(id)),host(std::move(h)),runner(this,fake){need(bool(host.snapshot)&&bool(host.preferences)&&bool(host.now),"paper-host-missing");timer.setInterval(30000);connect(&timer,&QTimer::timeout,this,[this]{try{tick();}catch(const std::exception&e){status="等待 / 阻断："+QString::fromUtf8(e.what());notify();}});}
Runtime::~Runtime(){changed={};try{setActive(false);}catch(...){} }
QJsonObject Runtime::book()const{return store.read(account);}
void Runtime::notify(){if(changed)changed();}
QJsonObject Runtime::mutate(const std::function<QJsonObject(QJsonObject)>&change){auto b=book();return store.transact(account,b.isEmpty()?-1:qint64(b["revision"].toDouble()),change);}
void Runtime::initialize(const QJsonObject&s){need(active,"paper-page-inactive");auto snapshot=host.snapshot();mutate([&](QJsonObject b){need(b.isEmpty(),"paper-book-already-exists");return seed(snapshot["input"].toObject(),s,host.now());});status="纸面起始账本已建立，监控及模拟成交默认关闭。";notify();}
void Runtime::configure(const QJsonObject&s){need(active,"paper-page-inactive");auto prior=book();need(!prior.isEmpty(),"paper-book-not-initialized");auto checked=paperAutomation::configure(prior,s,host.now());if(checked==prior)return;++generation;runner.cancel();mutate([&](QJsonObject b){return paperAutomation::configure(b,s,host.now());});status="已保存本机纸面执行设置。";notify();}
void Runtime::prepare(){need(active&&!busy(),"paper-inactive-or-busy");auto snapshot=host.snapshot();mutate([&](QJsonObject b){return prepareTask(b,snapshot["input"].toObject(),host.now(),"manual:"+QUuid::createUuid().toString(QUuid::WithoutBraces));});status="分析材料已冻结，等待本次内容授权。";notify();}
QString Runtime::awaiting(const QJsonObject&b)const{auto ts=b["tasks"].toObject();for(auto k:ts.keys())if(ts[k].toObject()["status"]=="awaiting-authorization")return k;throw std::runtime_error("没有等待授权的纸面分析任务");}
aiKnowledge::Prepared Runtime::request(){need(active&&!busy(),"paper-inactive-or-busy");auto b=book();auto id=awaiting(b);auto t=b["tasks"].toObject()[id].toObject();need(t["executionHash"].toString()==executionHash(b),"paper-material-changed");return aiKnowledge::preparePaper(host.preferences(),t["prepared"].toObject());}
void Runtime::start(const aiKnowledge::Prepared&plan,const std::shared_ptr<aiKnowledge::Grant>&grant,aiKnowledge::Credential credential){
 need(active&&!busy(),"paper-inactive-or-busy");auto expected=request();need(expected.digest()==plan.digest()&&expected.body()==plan.body(),"paper-request-changed");auto before=book();auto id=awaiting(before);auto prepared=before["tasks"].toObject()[id].toObject()["prepared"].toObject();auto current=host.snapshot()["input"].toObject();executionInput(before,current,host.now());
 mutate([&](QJsonObject b){return claim(b,id,prepared["preparationId"].toString(),host.now());});auto owner=++generation;status="正在请求本次已授权分析。";notify();
 runner.start(plan,grant,std::move(credential),[this,id,owner](QJsonObject attempt){
  if(owner!=generation||!active)return;
  try{auto at=host.now();if(attempt["status"]=="completed"){auto source=host.snapshot()["input"].toObject();mutate([&](QJsonObject b){auto next=accept(b,source,id,attempt["report"].toString(),at,QJsonObject{{"source",attempt["provenance"]},{"attemptId",attempt["id"]},{"previewDigest",attempt["previewDigest"]},{"verification",attempt["verification"]}});auto ts=next["tasks"].toObject(),t=ts[id].toObject();t["requestAttempt"]=attempt;ts[id]=t;next["tasks"]=ts;return next;});status="分析回包已保存并校验；成交仍须有效后续分钟行情。";}
   else{mutate([&](QJsonObject b){auto next=fail(b,id,at,attempt["errorCode"].toString(),attempt["status"]=="failed"||attempt["status"]=="timed-out");auto ts=next["tasks"].toObject(),t=ts[id].toObject();t["requestAttempt"]=attempt;ts[id]=t;next["tasks"]=ts;return next;});status="本次请求未完成："+attempt["status"].toString()+" / "+attempt["errorCode"].toString();}
  }catch(const std::exception&e){status="回包未消费："+QString::fromUtf8(e.what());try{mutate([&](QJsonObject b){return fail(b,id,host.now(),status,false);});}catch(...){status+="；状态写入冲突，重读后核对。";}}
  notify();
 });
}
void Runtime::tick(){if(!active||busy())return;auto b=book();if(b.isEmpty()||b["settings"].toObject()["enabled"]!=true)return;auto snapshot=host.snapshot(),input=snapshot["input"].toObject();if(host.refresh){QJsonArray ids;for(auto k:input["quotes"].toObject().keys())ids.append(k);host.refresh(ids);}auto now=host.now();mutate([&](QJsonObject state){auto next=schedule(state,input,now);auto s=input["session"].toObject();if(s["verified"]==true&&s["open"]==true&&s["continuous"]==true)next=execute(next,input,snapshot["markets"].toObject(),now);return next;});status="已核对当前交易日时段、分析任务及纸面订单；等待项保留原状态。";notify();}
void Runtime::cancel(const QString&reason){++generation;runner.cancel();auto b=book();if(!b.isEmpty())mutate([&](QJsonObject state){return paperAutomation::cancel(state,host.now(),reason);});status="当前任务和未成交订单已取消。";notify();}
void Runtime::setActive(bool value){if(value==active)return;active=value;if(active){timer.start();notify();}else{timer.stop();cancel("page-left-or-backgrounded");}}
}
