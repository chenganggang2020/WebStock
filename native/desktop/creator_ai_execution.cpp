#include "creator_ai_execution.hpp"
#include "creator_ai_model.hpp"
#include "research_runs_model.hpp"
#include <QDateTime>
#include <QUuid>
namespace creatorExecution {namespace {
void need(bool b,const char*m){if(!b)throw std::runtime_error(m);}
aiKnowledge::Prepared request(const QJsonObject&p,int i,const QJsonObject&prefs){auto b=p["blocks"].toArray()[i].toObject();auto text=b["text"].toString();auto full=creatorAi::prompt(p,i);auto suffix=QString::fromUtf8(researchRuns::canonical(text));need(full.endsWith(suffix),"creator-prompt-contract-changed");QString instruction=full.left(full.size()-suffix.size());auto row=p["sourceSnapshot"].toObject();row["id"]=p["sourceId"];row["text"]=text;row["sourceKind"]="collections";row["sourceRecordHash"]=p["recordHash"];row["sourceBodyHash"]=p["bodyHash"];row["sourceIdentity"]=p["sourceIdentity"];row["planHash"]=p["planHash"];row["blockIndex"]=i;row["blockStart"]=b["start"];row["blockEnd"]=b["end"];row["blockHash"]=b["blockHash"];return aiKnowledge::prepare(prefs,instruction,QJsonArray{QJsonObject{{"kind","collections"},{"id",p["sourceId"]},{"row",row}}});}
}
Receipt::Receipt(std::shared_ptr<Token>t,const QJsonObject&s,const QJsonObject&c,QJsonArray a):token(std::move(t)),sourceHash(researchRuns::fingerprint(s)),candidateHash(researchRuns::fingerprint(c)),attempts(std::move(a)){}
QJsonArray Receipt::validate(const QJsonObject&s,const QJsonObject&c)const{need(token&&token->valid&&!token->consumed,"execution-receipt-revoked");need(researchRuns::fingerprint(s)==sourceHash&&researchRuns::fingerprint(c)==candidateHash,"execution-receipt-mismatch");creatorAi::validateCandidate(s,c);return attempts;}
void Receipt::committed()const{token->consumed=true;}
Session::Session(Current c,Active a,QObject*p,QNetworkAccessManager*fake):QObject(p),current(std::move(c)),active(std::move(a)){runner=new aiKnowledge::Runner(this,fake);deadline.setSingleShot(true);connect(&deadline,&QTimer::timeout,this,[this]{cancel("timed-out");});state={{"status","idle"}};}
Session::~Session(){changed={};cancel();}
void Session::notify(){if(changed)changed();}
void Session::configure(Host h){cancel();host=std::move(h);}
void Session::exact()const{need(current&&researchRuns::canonical(current())==researchRuns::canonical(source),"source-version-changed");}
QJsonObject Session::prepare(const QJsonObject&r,const QJsonObject&prefs){cancel();requests.clear();source=r;plan={};attempts={};responses={};retained=0;index=0;exact();auto planned=creatorAi::plan(source);auto blocks=planned["blocks"].toArray();need(blocks.size()>0&&blocks.size()<=19,"block-count-invalid");std::vector<aiKnowledge::Prepared> prepared;QJsonArray previews;for(int i=0;i<blocks.size();++i){auto p=request(planned,i,prefs);prepared.push_back(p);previews.append(QJsonObject{{"index",i},{"digest",p.digest()},{"preview",p.preview()}});}plan=planned;requests=std::move(prepared);state={{"status","prepared"},{"planHash",plan["planHash"]},{"total",int(requests.size())},{"completed",0},{"requests",previews},{"authorization",ready()?"host-present-grant-still-required":"no-grant-or-credential"}};notify();return snapshot();}
bool Session::ready()const{return !requests.empty()&&bool(host.authorize)&&bool(host.credential);}
QJsonObject Session::snapshot()const{auto out=state;out["attempts"]=attempts;out["responses"]=responses;if(!candidate.isEmpty())out["candidate"]=candidate;return out;}
void Session::cancel(const QString&reason){++epoch;busy=false;deadline.stop();if(token)token->valid=false;proof.reset();candidate={};runner->cancel();state["status"]=reason;notify();}
void Session::fail(const QString&reason){cancel("failed");state["error"]=reason;notify();}
void Session::start(){need(!busy&&state["status"]=="prepared","prepare-before-execution");if(!ready()){state["status"]="blocked";state["error"]="no-grant-or-credential";notify();return;}auto before=epoch;try{need(active&&active(),"entry-inactive");exact();if(before!=epoch)return;}catch(const std::exception&e){fail(QString::fromUtf8(e.what()));return;}++epoch;token=std::make_shared<Receipt::Token>();proof.reset();candidate={};responses={};attempts={};index=0;retained=0;busy=true;state["status"]="running";state.remove("error");state["completed"]=0;deadline.start(300000);auto run=epoch;notify();QTimer::singleShot(0,this,[this,run]{next(run);});}
void Session::next(quint64 run){if(run!=epoch||!busy)return;try{
 need(active&&active(),"entry-inactive");exact();if(run!=epoch||!busy)return;if(index==int(requests.size())){candidate=creatorAi::aggregate(plan,responses,QUuid::createUuid().toString(QUuid::WithoutBraces),responses.first().toObject()["model"].toString(),QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));exact();if(run!=epoch||!busy)return;proof=std::shared_ptr<Receipt>(new Receipt(token,source,candidate,attempts));busy=false;deadline.stop();state["status"]="completed";notify();return;}
 const int block=index;const auto prepared=requests[block];auto grant=host.authorize(prepared);if(run!=epoch||!busy)return;exact();if(run!=epoch||!busy)return;need(active&&active(),"entry-inactive");
 auto credential=[this,run]{auto bytes=host.credential();if(run!=epoch||!busy||!active||!active()){bytes.fill('\0');throw std::runtime_error("execution-cancelled-during-credential");}return bytes;};
 runner->start(prepared,grant,credential,[this,run,block,prepared](QJsonObject attempt){if(run!=epoch||!busy)return;try{
  need(active&&active(),"entry-inactive");exact();if(run!=epoch||!busy)return;int size=QJsonDocument(attempt).toJson(QJsonDocument::Compact).size();need(size<=8*1024*1024-retained,"session-evidence-limit");retained+=size;attempts.append(attempt);
  need(attempt["status"]=="completed"&&attempt["finishReason"]=="stop","block-not-completed");need(attempt["previewDigest"]==prepared.digest()&&!attempt["previewRedacted"].toBool()&&!attempt["responseRedacted"].toBool(),"attempt-preview-or-response-mismatch");QString provenance;
  if(attempt["provenance"]=="local-fixture"&&!attempt["networkAttempted"].toBool())provenance="local-fixture";
  else {need(attempt["provenance"]=="direct-api-attempt"&&attempt["networkAttempted"].toBool(),"untrusted-attempt-provenance");provenance="provider-response";}
  auto b=plan["blocks"].toArray()[block].toObject();QJsonObject envelope{{"planHash",plan["planHash"]},{"index",block},{"blockHash",b["blockHash"]},{"status","completed"},{"finishReason","stop"},{"model",attempt["reportedModel"]},{"provenance",provenance},{"content",attempt["report"]}};creatorAi::validateResponse(plan,envelope);responses.append(envelope);++index;state["completed"]=index;notify();QTimer::singleShot(0,this,[this,run]{next(run);});
 }catch(const std::exception&e){if(run==epoch)fail(QString::fromUtf8(e.what()));}});
 }catch(const std::exception&e){if(run==epoch)fail(QString::fromUtf8(e.what()));}}
}
