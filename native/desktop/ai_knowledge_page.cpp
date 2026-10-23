#include "ai_knowledge_page.hpp"
#include "request_authorization_widget.hpp"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QGridLayout>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QCheckBox>
#include <QPlainTextEdit>
#include <QTabWidget>
#include <QJsonDocument>
#include <QFileDialog>
#include <QHideEvent>
#include <QGuiApplication>
#include <QSignalBlocker>
static QString stateText(const QJsonObject&a){auto s=a["status"].toString();return s=="completed"?"已收到结果，待核验":s=="cancelled"?"本机请求已取消":s=="timed-out"?"本机等待已超时":s=="refused"?"服务方拒绝回答":s=="incomplete"?"输出被截断，不能作为完整结果":s=="blocked"?"尚未获得有效授权或短期凭据":"请求失败，错误证据已保留";}
static QString resultView(const QJsonObject&a){return (a["provenance"]=="local-fixture"?QString("本地假回包检查 · 非真实 AI 执行\n"):QString())+stateText(a)+"\n\n全文结果\n"+(a["report"].toString().isEmpty()?QString("本次没有完整文本结果"):a["report"].toString())+"\n\n完整来源、请求与响应档案\n"+QString::fromUtf8(QJsonDocument(a).toJson());}
AiKnowledgePage::AiKnowledgePage(QJsonObject p,QJsonArray m,QString directory,Host h,QWidget*parent,QNetworkAccessManager*fake):QWidget(parent),preferences(std::move(p)),materials(std::move(m)),archiveDirectory(std::move(directory)),host(std::move(h)){
 setObjectName("aiKnowledgePage");runner=new aiKnowledge::Runner(this,fake);auto layout=new QVBoxLayout(this);
 auto boundary=new QLabel("资料研究请求 · 仅分析所选本机材料；结果需核验。无自动检索、工具执行或交易。API 费用和模型权限须由宿主确认。");boundary->setWordWrap(true);layout->addWidget(boundary);
 question=new QLineEdit;question->setObjectName("knowledgeQuestion");question->setPlaceholderText("研究问题");layout->addWidget(question);
 auto buttons=new QGridLayout;previewButton=new QPushButton("预览完整外发内容");previewButton->setObjectName("knowledgePreview");sendButton=new QPushButton("请求发送一次");sendButton->setObjectName("knowledgeSend");cancelButton=new QPushButton("取消等待");cancelButton->setObjectName("knowledgeCancel");auto history=new QPushButton("读取本机请求档案");history->setObjectName("knowledgeReplay");int i=0;for(auto*b:{previewButton,sendButton,cancelButton,history}){buttons->addWidget(b,i/2,i%2);++i;}layout->addLayout(buttons);
 consent=new QCheckBox("已审阅完整内容，确认本次外发及 API 费用");consent->setObjectName("knowledgeConsent");layout->addWidget(consent);auto warning=new QLabel("请核对服务方、模型与全部材料。取消只停止本机等待，不撤销已到达服务方的请求或其费用。");warning->setWordWrap(true);layout->addWidget(warning);message=new QLabel;message->setWordWrap(true);message->setObjectName("knowledgeMessage");layout->addWidget(message);
 auto tabs=new QTabWidget;previewText=new QPlainTextEdit;previewText->setObjectName("knowledgeOutbound");previewText->setReadOnly(true);resultText=new QPlainTextEdit;resultText->setObjectName("knowledgeResult");resultText->setReadOnly(true);tabs->addTab(previewText,"完整外发材料 / 服务方");tabs->addTab(resultText,"全文结果 / 来源与错误档案");layout->addWidget(tabs,1);
 if(!host.authorize&&!host.credential){authority=new RequestAuthorizationWidget([this]{return actionAllowed();},this);layout->insertWidget(4,authority);host.authorize=[this](const aiKnowledge::Prepared&r){return authority->authorize(r);};host.credential=[this]{return authority->acquire();};authority->changed=[this]{refresh();};authority->expired=[this]{cancel();};}
 connect(qApp,&QGuiApplication::applicationStateChanged,this,[this](Qt::ApplicationState s){if(s!=Qt::ApplicationActive)cancel();});
 connect(question,&QLineEdit::textChanged,this,[this]{if(actionAllowed(question))invalidatePreview();});connect(consent,&QCheckBox::toggled,this,[this]{if(actionAllowed(consent))refresh();});connect(previewButton,&QPushButton::clicked,this,[this]{if(actionAllowed(previewButton))preview();});connect(sendButton,&QPushButton::clicked,this,[this]{send();});connect(cancelButton,&QPushButton::clicked,this,[this]{if(actionAllowed(cancelButton))cancel();});
 connect(history,&QPushButton::clicked,this,[this,history]{if(!actionAllowed(history)||runner->running())return;auto file=QFileDialog::getOpenFileName(this,"读取本机请求档案",archiveDirectory,"请求档案 (*.json)");if(!actionAllowed(history))return;if(!file.isEmpty())try{replay(file);}catch(...){message->setText("档案读取或完整性检查失败，未发起请求。");}});
 message->setText(authority?"默认无授权与凭据。先预览，再主动授权当前请求。":host.authorize&&host.credential?"待预览；宿主仍须确认本次模型权限和费用授权。":"未就绪：宿主未接入本次授权与短期凭据。可预览，不能发送。");refresh();
}
AiKnowledgePage::~AiKnowledgePage(){cancel();}
bool AiKnowledgePage::actionAllowed(const QWidget* origin)const{return isVisible()&&isEnabled()&&!window()->isMinimized()&&QGuiApplication::applicationState()==Qt::ApplicationActive&&(!origin||(origin->isVisible()&&origin->isEnabled()));}
void AiKnowledgePage::invalidatePreview(){if(authority)authority->clear();prepared.reset();consent->setChecked(false);previewText->clear();refresh();}
void AiKnowledgePage::refresh(){bool busy=runner->running();question->setEnabled(!busy);previewButton->setEnabled(!busy);consent->setEnabled(!busy&&prepared.has_value());sendButton->setEnabled(!busy&&prepared.has_value()&&consent->isChecked()&&bool(host.authorize)&&bool(host.credential)&&(!authority||authority->ready()));cancelButton->setEnabled(busy||prepared.has_value());}
void AiKnowledgePage::preview(){if(!actionAllowed()||runner->running())return;try{prepared=aiKnowledge::prepare(preferences,question->text(),materials);previewText->setPlainText(QString::fromUtf8(QJsonDocument(prepared->preview()).toJson()));if(authority)authority->bind({*prepared});consent->setChecked(false);message->setText("完整外发内容已展示；尚未发送。请核对服务方、模型、全部材料和费用授权。");}catch(...){invalidatePreview();message->setText("无法预览：服务方合同、设置、资料身份或大小检查未通过；没有发送。");}refresh();}
void AiKnowledgePage::send(){if(!actionAllowed(sendButton)||!prepared||runner->running())return;
 auto plan=*prepared;std::shared_ptr<aiKnowledge::Grant> grant;
 try{grant=host.authorize(plan);}catch(...){message->setText("宿主未授予本次请求；没有发送。");consent->setChecked(false);return;}
 consent->setChecked(false);prepared.reset();message->setText("正在处理本次明确请求；可取消本机等待。");
 runner->start(plan,grant,host.credential,[this](QJsonObject result){if(authority)authority->clear();latest=result;archiveFile.clear();QString archiveStatus;try{archiveFile=aiKnowledge::writeArchive(archiveDirectory,latest);archiveStatus="；完整请求和结果已归档。";}catch(...){archiveStatus="；归档失败，当前完整结果仍保留在页面。";}
  previewText->setPlainText(QString::fromUtf8(QJsonDocument(latest["preview"].toObject()).toJson()));resultText->setPlainText(resultView(latest));message->setText((latest["provenance"]=="local-fixture"?QString("本地假回包检查 · "):QString())+stateText(latest)+archiveStatus);refresh();});refresh();
}
void AiKnowledgePage::cancel(){if(authority)authority->clear();runner->cancel();prepared.reset();{QSignalBlocker block(consent);consent->setChecked(false);}refresh();}
void AiKnowledgePage::hideEvent(QHideEvent*event){cancel();QWidget::hideEvent(event);}
void AiKnowledgePage::setInput(QJsonObject p,QJsonArray m){cancel();preferences=std::move(p);materials=std::move(m);invalidatePreview();message->setText("输入已更新，需要重新预览和确认。");}
void AiKnowledgePage::replay(const QString&file){cancel();auto saved=aiKnowledge::readArchive(file);invalidatePreview();latest=saved;archiveFile=file;previewText->setPlainText(QString::fromUtf8(QJsonDocument(latest["preview"].toObject()).toJson()));resultText->setPlainText(resultView(latest));message->setText("只读档案回放 · "+(latest["provenance"]=="local-fixture"?QString("本地假回包 · "):QString())+stateText(latest)+"；没有发起请求。");}
