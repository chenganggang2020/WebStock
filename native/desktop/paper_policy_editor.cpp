#include "paper_policy_editor.hpp"
namespace paperPolicy {
Editor::Editor(Host h,QString file,QWidget*parent):QWidget(parent),host(std::move(h)),store(std::move(file)){
 auto layout=new QVBoxLayout(this);auto title=new QLabel("纸面账户观察设置");title->setObjectName("paperPolicyTitle");layout->addWidget(title);
 auto info=new QLabel("请明确选择账户状态和单股权重上限。保存只影响纸面观察，不会生成订单或修改现金。");info->setWordWrap(true);layout->addWidget(info);
 state=new QComboBox;state->setObjectName("paperPolicyStatus");state->addItem("请选择状态","");state->addItem("观察中","active");state->addItem("暂停观察","paused");layout->addWidget(state);
 layout->addWidget(new QLabel("单股权重上限（%）"));percent=new QLineEdit;percent->setObjectName("paperPolicyPercent");percent->setPlaceholderText("大于等于 0.0001 且不超过 100");layout->addWidget(percent);
 confirmed=new QCheckBox("我已核对目标纸面账户及上述设置");confirmed->setObjectName("paperPolicyConfirmed");layout->addWidget(confirmed);
 auto row=new QHBoxLayout;save=new QPushButton("保存设置");save->setObjectName("paperPolicySave");auto refresh=new QPushButton("重读已保存设置");row->addWidget(save);row->addWidget(refresh);layout->addLayout(row);
 message=new QLabel;message->setObjectName("paperPolicyMessage");message->setWordWrap(true);layout->addWidget(message);layout->addStretch();
 connect(save,&QPushButton::clicked,this,[this]{submit();});connect(refresh,&QPushButton::clicked,this,[this]{reload();});reload();
}
void Editor::reload(){
 save->setEnabled(false);confirmed->setChecked(false);state->setCurrentIndex(0);percent->clear();revision=-1;
 try{
  shownAccount=host.account();if(shownAccount.value("type")!="paper")throw std::runtime_error("paper");
  auto a=store.read();revision=a.value("revision").toDouble();auto r=latest(a,shownAccount.value("id").toString());
  findChild<QLabel*>("paperPolicyTitle")->setText("纸面账户："+shownAccount.value("name").toString()+"（"+shownAccount.value("id").toString()+"）");
  if(!r.isEmpty()){state->setCurrentIndex(state->findData(r.value("status").toString()));percent->setText(QString::number(r.value("maxSingleWeight").toDouble()*100,'g',15));}
  save->setEnabled(true);message->setText(r.isEmpty()?"尚未配置，纸面准备保持阻断。":"已读取保存版本，请核对后再保存。");
 }catch(const std::exception&){message->setText("设置读取失败或目标并非纸面账户；原文件保留。");}
}
void Editor::submit(){
 if(!isVisible()||!isActiveWindow())return;
 try{
  if(revision<0||!confirmed->isChecked()||state->currentData().toString().isEmpty())throw std::runtime_error("required");
  auto text=percent->text().trimmed();if(!QRegularExpression("^(?:[0-9]+(?:\\.[0-9]+)?|\\.[0-9]+)$").match(text).hasMatch())throw std::runtime_error("weight");
  bool ok=false;double limit=text.toDouble(&ok)/100.;if(!ok)throw std::runtime_error("weight");
  auto account=host.account();for(auto k:{"id","name","type"})if(account.value(k)!=shownAccount.value(k))throw std::runtime_error("identity");
  auto saved=store.save(account,state->currentData().toString(),limit,qint64(revision),host.now(),true);revision=saved.value("revision").toDouble();confirmed->setChecked(false);
  message->setText("已保存版本 "+QString::number(qint64(revision))+"。后续准备和确认将重新读取此设置。");
 }catch(const std::exception&){message->setText("未保存：请核对账户、明确状态和有效比例；设置若已被其他入口修改，请先重读。");}
}
}
