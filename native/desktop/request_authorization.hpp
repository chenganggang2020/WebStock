#pragma once
#include "ai_knowledge_request.hpp"
#include <QDateTime>
#include <QRegularExpression>
#include <mutex>
#include <vector>
namespace requestAuthorization {
// Only immutable Prepared objects are accepted. No serialization or credential discovery.
class Lease final {
 using Clock=std::function<qint64()>;
 Clock clock;mutable std::mutex mutex;
 std::vector<aiKnowledge::Prepared> requests;
 std::vector<std::shared_ptr<aiKnowledge::Grant>> issued;
 QByteArray secret;size_t cursor=0;std::shared_ptr<aiKnowledge::Grant> pending;
 qint64 expires=0;bool approved=false;
 void wipe(){secret.fill('\0');secret.clear();}
 void revokeLocked(){for(auto&g:issued)g->revoked=true;issued.clear();pending.reset();wipe();approved=false;expires=0;cursor=0;}
 static void require(bool ok,const char*why){if(!ok)throw std::runtime_error(why);}
public:
 explicit Lease(Clock now=[] {return QDateTime::currentMSecsSinceEpoch();}):clock(std::move(now)){}
 ~Lease(){revoke();}
 Lease(const Lease&)=delete;Lease&operator=(const Lease&)=delete;
 void bind(std::vector<aiKnowledge::Prepared> list){std::lock_guard<std::mutex> lock(mutex);revokeLocked();requests.clear();require(!list.empty()&&list.size()<=19,"authorization-request-count");requests=std::move(list);}
 std::vector<aiKnowledge::Prepared> review()const{std::lock_guard<std::mutex> lock(mutex);return requests;}
 void approve(QByteArray credential,bool reviewed,bool model,bool billing,bool active,qint64 ttl=120000){
  std::lock_guard<std::mutex> lock(mutex);revokeLocked();
  try{require(active&&!requests.empty()&&reviewed&&model&&billing,"explicit-request-consent-required");require(ttl>0&&ttl<=300000,"authorization-lifetime-invalid");
   require(QRegularExpression("^[A-Za-z0-9_.-]{16,4096}$").match(QString::fromLatin1(credential)).hasMatch(),"credential-format-invalid");
   for(const auto&r:requests)require(!aiKnowledge::bytes(r.preview()).contains(credential),"credential-found-in-material");
   secret=credential;secret.detach();expires=clock()+ttl;approved=true;
  }catch(...){credential.fill('\0');throw;}credential.fill('\0');
 }
 bool ready()const{std::lock_guard<std::mutex> lock(mutex);return approved&&clock()<expires&&cursor<requests.size()&&!pending;}
 qint64 deadline()const{std::lock_guard<std::mutex> lock(mutex);return expires;}
 std::shared_ptr<aiKnowledge::Grant> authorize(const aiKnowledge::Prepared&r){
  std::lock_guard<std::mutex> lock(mutex);require(approved&&clock()<expires&&cursor<requests.size()&&!pending,"authorization-required-or-stale");
  const auto&exact=requests[cursor];require(exact.digest()==r.digest()&&exact.body()==r.body(),"authorization-request-binding-mismatch");
  auto g=std::make_shared<aiKnowledge::Grant>();g->previewDigest=r.digest();g->expiresAtMs=expires;g->networkAuthorized=g->modelCompatible=g->providerBillingAccepted=true;issued.push_back(g);pending=g;return g;
 }
 QByteArray acquire(){
  std::lock_guard<std::mutex> lock(mutex);require(approved&&clock()<expires&&pending&&pending->consumed&&!pending->revoked,"credential-without-consumed-request-grant");
  QByteArray value=secret;value.detach();pending.reset();++cursor;if(cursor==requests.size()){wipe();approved=false;}return value;
 }
 void revoke(){std::lock_guard<std::mutex> lock(mutex);revokeLocked();}
 void unbind(){std::lock_guard<std::mutex> lock(mutex);revokeLocked();requests.clear();}
};
}
