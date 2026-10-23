#include "paper_monitor_host_page.hpp"
#include "paper_monitor_legacy.hpp"
#include "paper_policy_editor.hpp"
namespace paperHost {
Page::Page(std::shared_ptr<Flow> f,QWidget*parent):QWidget(parent),flow(std::move(f)){
 auto outer=new QVBoxLayout(this);stack=new QStackedWidget;outer->addWidget(stack);main=new QWidget;stack->addWidget(main);auto layout=new QVBoxLayout(main);
 auto note=new QLabel("纸面监控 · 使用已载入报价，不执行真实交易");note->setWordWrap(true);layout->addWidget(note);
 auto select=new QHBoxLayout;accounts=new QComboBox;accounts->setObjectName("paperHostAccount");select->addWidget(accounts,1);auto refresh=new QPushButton("重读账户");auto settingsButton=new QPushButton("账户策略设置");select->addWidget(refresh);select->addWidget(settingsButton);layout->addLayout(select);
 auto automatic=new QPushButton("自动监控 / 模拟成交");automatic->setObjectName("paperHostAutomation");layout->addWidget(automatic);connect(automatic,&QPushButton::clicked,this,[this]{runMain([this]{showAutomation();});});
 scope=new QCheckBox("我已核对本次纸面账户、手工现金及本机持仓范围");scope->setObjectName("paperHostScope");layout->addWidget(scope);
 auto actions=new QHBoxLayout;auto prepare=new QPushButton("检查并准备");prepare->setObjectName("paperHostPrepare");auto evidence=new QPushButton("证据 / 提示词");auto preview=new QPushButton("预览人工答复");preview->setObjectName("paperHostPreview");for(auto b:{prepare,evidence,preview})actions->addWidget(b);layout->addLayout(actions);
 response=new QPlainTextEdit;response->setObjectName("paperHostResponse");response->setPlaceholderText("人工六字段 JSON 答复：asOf、marketView、cashTargetPercent、orders、portfolioRisk、nextReviewAt");response->setMaximumHeight(150);layout->addWidget(response);
 decisionAck=new QCheckBox("我已阅读本次预览，并明确确认 / 拒绝归档；不会执行交易");decisionAck->setObjectName("paperHostDecisionAck");layout->addWidget(decisionAck);
 auto decisions=new QHBoxLayout;confirm=new QPushButton("确认并归档");confirm->setObjectName("paperHostConfirm");reject=new QPushButton("拒绝并归档");auto cancel=new QPushButton("取消准备 / 保留草稿");for(auto b:{confirm,reject,cancel})decisions->addWidget(b);layout->addLayout(decisions);
 history=new QComboBox;history->setObjectName("paperHostHistory");layout->addWidget(history);status=new QLabel;status->setWordWrap(true);status->setObjectName("paperHostStatus");layout->addWidget(status);
 reader=new QPlainTextEdit;reader->setObjectName("paperHostReader");reader->setReadOnly(true);layout->addWidget(reader,1);
 saveTimer.setSingleShot(true);saveTimer.setInterval(300);connect(&saveTimer,&QTimer::timeout,this,[this]{runMain([this]{flushResponse();});});
 connect(response,&QPlainTextEdit::textChanged,this,[this]{if(!filling){responseDirty=true;confirm->setEnabled(false);reject->setEnabled(false);decisionAck->setChecked(false);saveTimer.start();}});
 connect(accounts,&QComboBox::activated,this,[this](int){runMain([this]{flushResponse();flow->selectAccount(accounts->currentData().toString());{QSignalBlocker b(scope);scope->setChecked(false);}decisionAck->setChecked(false);render();});});
 connect(refresh,&QPushButton::clicked,this,[this]{runMain([this]{flushResponse();flow->cancel();refreshAccounts();render();});});
 connect(settingsButton,&QPushButton::clicked,this,[this]{runMain([this]{showSettings();});});
 connect(scope,&QCheckBox::toggled,this,[this]{runMain([this]{flushResponse();flow->cancel();render();});});
 connect(prepare,&QPushButton::clicked,this,[this]{runMain([this]{flushResponse();flow->prepare(scope->isChecked());decisionAck->setChecked(false);render();reader->setPlainText(flow->state().value("prompt").toString());status->setText("本次准备就绪。请审阅冻结证据和提示词，再填写人工答复。");});});
 connect(evidence,&QPushButton::clicked,this,[this]{reader->setPlainText(flow->state().value("prompt").toString());});
 connect(preview,&QPushButton::clicked,this,[this]{runMain([this]{flushResponse();flow->preview();decisionAck->setChecked(false);render();});});
 auto choose=[this](QString choice){runMain([this,choice]{flushResponse();flow->decide(choice,decisionAck->isChecked());decisionAck->setChecked(false);render();status->setText("纸面决定已归档；未写入订单、现金或持仓。");});};
 connect(confirm,&QPushButton::clicked,this,[choose]{choose("confirmed");});connect(reject,&QPushButton::clicked,this,[choose]{choose("rejected");});
 connect(cancel,&QPushButton::clicked,this,[this]{runMain([this]{flushResponse();flow->cancel();decisionAck->setChecked(false);render();status->setText("准备已取消，全文草稿保留。");});});
 connect(history,&QComboBox::activated,this,[this](int index){if(index>0)runMain([this,index]{flushResponse();flow->selectHistory(index-1);decisionAck->setChecked(false);render();status->setText("历史只读，不能用旧输入再次确认。");});});
 guard([this]{refreshAccounts();render();});
}
void Page::guard(std::function<void()> action){try{action();}catch(const std::exception&e){confirm->setEnabled(false);reject->setEnabled(false);status->setText("已阻断："+QString::fromUtf8(e.what())+"；原业务数据保留。");}}
void Page::runMain(std::function<void()> action){if(isVisible()&&isActiveWindow()&&main->isVisible()&&flow->state().value("active")==true)guard(std::move(action));}
void Page::flushResponse(){saveTimer.stop();auto s=flow->state();if(!s.value("accountId").toString().isEmpty()&&s.value("response").toString()!=response->toPlainText())flow->setResponse(response->toPlainText());if(s.value("writable")==true)responseDirty=false;}
void Page::refreshAccounts(){QSignalBlocker block(accounts);accounts->clear();accounts->addItem("请选择纸面账户","");for(auto v:flow->accounts()){auto a=v.toObject();accounts->addItem(a.value("name").toString()+" ("+a.value("id").toString()+")",a.value("id").toString());}accounts->setCurrentIndex(qMax(0,accounts->findData(flow->state().value("accountId").toString())));}
void Page::render(){
 auto s=flow->state();filling=true;if(!responseDirty)response->setPlainText(s.value("response").toString());filling=false;confirm->setEnabled(!responseDirty&&s.value("canConfirm")==true);reject->setEnabled(!responseDirty&&s.value("canReject")==true);
 QSignalBlocker block(history);const auto displayed=s.value("result").toObject();auto selectedHistory=displayed.value("schema")=="native-paper-monitor-legacy-view/v1"?displayed.value("entry").toObject().value("id").toString():displayed.value("prepared").toObject().value("preparationId").toString();history->clear();history->addItem("纸面历史（只读）");for(auto v:flow->history()){auto r=v.toObject();if(r.value("schema")=="native-paper-monitor-legacy-entry/v1")history->addItem(paperLegacy::label(r),r.value("id").toString());else history->addItem(r.value("recordedAt").toString()+" / "+r.value("choice").toString(),r.value("prepared").toObject().value("preparationId").toString());}if(!selectedHistory.isEmpty())history->setCurrentIndex(qMax(0,history->findData(selectedHistory)));
 auto result=s.value("result").toObject();reader->setPlainText(result.isEmpty()?s.value("prompt").toString():(result.value("schema")=="native-paper-monitor-legacy-view/v1"?paperLegacy::label(result.value("entry").toObject())+"\n旧启用状态只作历史证据，不恢复执行；无旧订单、成交和持仓。\n\n":QString())+QString::fromUtf8(QJsonDocument(result).toJson(QJsonDocument::Indented)));
 auto evidence=s.value("evidence").toObject();auto until=evidence.value("input").toObject().value("hostEvidence").toObject().value("session").toObject().value("validBefore").toString();
 status->setText("所选账户："+s.value("accountId").toString()+"；"+(s.value("preparedForCurrentSession")==true?"本次准备有效，确认前将重新读取。":"留存证据只读，请重新准备。")+(until.isEmpty()?QString():"证据会话截至 "+until));
 if(responseDirty||s.value("writable")!=true)status->setText("答复尚未成功保存，当前文字保留在内存；旧草稿未覆盖。请缩短过长答复或核对保存冲突。");
 response->setEnabled(!s.value("accountId").toString().isEmpty()&&s.value("active")==true&&s.value("writable")==true);
}
void Page::showSettings(){flushResponse();flow->cancel();if(settings){stack->removeWidget(settings);delete settings;}settings=new QWidget;auto layout=new QVBoxLayout(settings);auto back=new QPushButton("返回纸面监控");layout->addWidget(back);auto f=flow;layout->addWidget(new paperPolicy::Editor({[f]{return f->currentAccount();},[f]{return f->now();}},flow->settingsPath(),settings));stack->addWidget(settings);stack->setCurrentWidget(settings);connect(back,&QPushButton::clicked,this,[this]{this->back();});}
void Page::setAutomationHost(std::function<QJsonObject()> p,std::function<void(QJsonArray)> r,QNetworkAccessManager* fixture){automationFixture=fixture;automationPreferences=std::move(p);automationRefresh=std::move(r);}
void Page::showAutomation(){flushResponse();flow->cancel();auto id=flow->state()["accountId"].toString();if(id.isEmpty())throw std::runtime_error("请先选择现有纸面账户并配置策略");auto f=flow;if(automation){stack->removeWidget(automation);delete automation;}automation=new paperAutomation::Page(flow->automationPath(),id,{[f]{return f->automationSnapshot();},automationPreferences?automationPreferences:[]{return QJsonObject{};},[f]{return f->now();},automationRefresh},this,automationFixture);automation->back=[this]{this->back();};stack->addWidget(automation);stack->setCurrentWidget(automation);automation->setActive(isActiveWindow());}
bool Page::back(){if(automation&&stack->currentWidget()==automation){automation->setActive(false);stack->setCurrentWidget(main);stack->removeWidget(automation);delete automation;automation=nullptr;guard([this]{render();});return true;}if(stack->currentWidget()==settings){guard([this]{flow->cancel();stack->setCurrentWidget(main);scope->setChecked(false);render();});return true;}return false;}
void Page::setActive(bool value){if(!value&&!flow->isActive()&&(!automation||!automation->isActive())){saveTimer.stop();QSignalBlocker b(scope);scope->setChecked(false);decisionAck->setChecked(false);return;}if(automation)automation->setActive(value&&automation->isVisible());if(!value){guard([this]{flushResponse();});guard([this]{flow->setActive(false);});QSignalBlocker b(scope);scope->setChecked(false);decisionAck->setChecked(false);guard([this]{render();});}else guard([this]{flow->setActive(true);render();});}
void Page::hideEvent(QHideEvent*event){setActive(false);QWidget::hideEvent(event);}
void Page::setDarkTheme(bool dark){setStyleSheet(dark?"QWidget{background:#172334;color:#f1f5fa} QPlainTextEdit,QComboBox{background:#22334a;color:#f1f5fa}":"");}
QJsonObject Page::saveState(){flushResponse();return flow->marker();}
void Page::restoreState(QJsonObject marker){guard([this,marker]{flow->restore(marker);refreshAccounts();render();});}
}
