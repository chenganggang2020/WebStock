#pragma once
#include "request_authorization.hpp"
#include <QtWidgets>
class RequestAuthorizationWidget final:public QWidget {
 requestAuthorization::Lease lease;std::function<bool()> owner;
 QComboBox*requests;QPlainTextEdit*body;QLineEdit*credential;QCheckBox *reviewed,*model,*billing;QLabel*status;QTimer timer;bool internalEdit=false;
public:
 std::function<void()> changed,expired;
 explicit RequestAuthorizationWidget(std::function<bool()> active,QWidget*parent=nullptr):QWidget(parent),owner(std::move(active)){
  setObjectName("requestAuthorization");auto layout=new QVBoxLayout(this);
  auto title=new QLabel("当前请求的短期授权 · 默认无授权 / 无凭据",this);title->setWordWrap(true);layout->addWidget(title);
  requests=new QComboBox(this);requests->setObjectName("authorizationRequests");layout->addWidget(requests);
  body=new QPlainTextEdit(this);body->setObjectName("authorizationExactBody");body->setReadOnly(true);body->setMaximumHeight(140);layout->addWidget(body);
  reviewed=new QCheckBox("已逐项核对完整待发送材料、服务方、端点、模型和摘要",this);reviewed->setObjectName("authorizationReviewed");layout->addWidget(reviewed);
  model=new QCheckBox("我确认本次账户可使用所选模型（尚未在线验证）",this);model->setObjectName("authorizationModel");layout->addWidget(model);
  billing=new QCheckBox("同意仅这些请求外发，并接受提供方可能计费",this);billing->setObjectName("authorizationBilling");layout->addWidget(billing);
  credential=new QLineEdit(this);credential->setObjectName("authorizationCredential");credential->setEchoMode(QLineEdit::Password);credential->setInputMethodHints(Qt::ImhSensitiveData|Qt::ImhNoPredictiveText|Qt::ImhNoAutoUppercase);credential->setPlaceholderText("主动输入本次 API 凭据；仅存内存，不保存");layout->addWidget(credential);
  auto bar=new QHBoxLayout;layout->addLayout(bar);auto approve=new QPushButton("授权当前请求列表 · 2分钟",this);approve->setObjectName("authorizationApprove");bar->addWidget(approve);auto cancel=new QPushButton("撤销授权",this);cancel->setObjectName("authorizationRevoke");bar->addWidget(cancel);
  status=new QLabel("请先生成并阅读精确请求。",this);status->setWordWrap(true);status->setObjectName("authorizationStatus");layout->addWidget(status);
  for(auto*b:{reviewed,model,billing})connect(b,&QCheckBox::toggled,this,[this](bool checked){if(!internalEdit&&!checked&&lease.deadline()){clear();status->setText("确认已撤回；本次授权已撤销，请重新预览。");if(expired)expired();}});
  connect(credential,&QLineEdit::textChanged,this,[this]{if(!internalEdit&&lease.deadline()){clear();status->setText("凭据已更改；旧授权已撤销，请重新预览再输入。");if(expired)expired();}});
  connect(requests,qOverload<int>(&QComboBox::currentIndexChanged),this,[this](int n){showRequest(n);});
  connect(approve,&QPushButton::clicked,this,[this]{if(!isVisible()||!owner||!owner())return;try{lease.approve(credential->text().toLatin1(),reviewed->isChecked(),model->isChecked(),billing->isChecked(),true);{QSignalBlocker block(credential);credential->clear();}status->setText("仅预览请求获得短期、逐次授权；仍需明确开始。");}catch(...){lease.revoke();credential->clear();status->setText("授权未建立。请完成确认并输入有效的本次凭据。");}if(changed)changed();});
  connect(cancel,&QPushButton::clicked,this,[this]{clear();if(expired)expired();});
  connect(&timer,&QTimer::timeout,this,[this]{auto d=lease.deadline();if(d&&(QDateTime::currentMSecsSinceEpoch()>=d||!owner||!owner())){clear();if(expired)expired();}});timer.start(250);
 }
 void bind(std::vector<aiKnowledge::Prepared> list){clear();lease.bind(std::move(list));QSignalBlocker block(requests);requests->clear();auto rows=lease.review();for(size_t i=0;i<rows.size();++i)requests->addItem(QString("请求 %1 / %2").arg(i+1).arg(rows.size()));showRequest(0);status->setText("完整正文与摘要如下；请逐项审阅后主动授权。");if(changed)changed();}
 void clear(){internalEdit=true;lease.unbind();requests->clear();body->clear();credential->clear();for(auto*b:{reviewed,model,billing}){QSignalBlocker block(b);b->setChecked(false);}status->setText("本次授权已撤销；凭据已清除。");internalEdit=false;if(changed)changed();}
 bool ready()const{return lease.ready();}
 std::shared_ptr<aiKnowledge::Grant> authorize(const aiKnowledge::Prepared&r){return lease.authorize(r);}
 QByteArray acquire(){return lease.acquire();}
private:
 void showRequest(int n){auto rows=lease.review();if(n<0||size_t(n)>=rows.size()){body->clear();return;}const auto&r=rows[n];auto p=r.preview();body->setPlainText("服务方："+p["provider"].toString()+"\n端点："+p["endpoint"].toString()+"\n模型："+p["model"].toString()+"\n预览摘要："+r.digest()+"\n请求正文 SHA256："+aiKnowledge::hash(r.body())+"\nUTF-8 字节数："+QString::number(r.body().size())+"\n\n实际待发送的完整请求正文：\n"+QString::fromUtf8(r.body()));}
};
