#include "ai_settings_page.hpp"
#include "ai_settings_capabilities.hpp"
#include <QComboBox>
#include <QLineEdit>
#include <QSpinBox>
#include <QDoubleSpinBox>
#include <QCheckBox>
#include <QLabel>
#include <QPushButton>
#include <QPlainTextEdit>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QFormLayout>
#include <QScrollArea>
#include <QJsonDocument>
#include <QFileDialog>
#include <QSaveFile>
namespace {QString error(){return QStringLiteral("操作失败：格式、范围或本地档案检查未通过。原输入未保存。");}}
AiSettingsPage::AiSettingsPage(QString path,QWidget* parent):QWidget(parent),store(path){
 setObjectName("aiSettingsPage");auto root=new QVBoxLayout(this);message=new QLabel("仅保存非敏感设置；接口未验证",this);message->setWordWrap(true);root->addWidget(message);
 auto scroll=new QScrollArea(this);scroll->setWidgetResizable(true);root->addWidget(scroll,1);auto body=new QWidget;scroll->setWidget(body);auto layout=new QVBoxLayout(body);auto form=new QFormLayout;layout->addLayout(form);
 provider=new QComboBox;provider->setObjectName("aiProvider");provider->addItem("手动交接","manual-handoff");provider->addItem("OpenAI","openai");provider->addItem("兼容接口","openai-compatible");
 model=new QLineEdit;model->setObjectName("aiModel");model->setMaxLength(128);endpoint=new QLineEdit;endpoint->setObjectName("aiEndpoint");endpoint->setMaxLength(512);
 timeout=new QSpinBox;timeout->setObjectName("aiTimeout");timeout->setRange(1000,300000);tokens=new QSpinBox;tokens->setObjectName("aiTokens");tokens->setRange(128,65536);temperature=new QDoubleSpinBox;temperature->setRange(-0.01,2);temperature->setDecimals(2);temperature->setSpecialValueText("未填写");sendTemperature=new QCheckBox("显式发送温度");enabled=new QCheckBox("保存启用偏好（不授权网络）");
 form->addRow("供应商",provider);form->addRow("模型标识",model);form->addRow("完整 HTTPS 接口",endpoint);form->addRow("超时（毫秒）",timeout);form->addRow("最大输出令牌",tokens);form->addRow("温度",temperature);form->addRow(sendTemperature);form->addRow(enabled);
 auto buttons=new QHBoxLayout;layout->addLayout(buttons);auto save=new QPushButton("保存非敏感配置"),cancel=new QPushButton("取消 / 重读");save->setObjectName("aiSave");cancel->setObjectName("aiCancel");buttons->addWidget(save);buttons->addWidget(cancel);handoff=new QPushButton("打开手动研究交接");handoff->setEnabled(false);layout->addWidget(handoff);
 layout->addWidget(new QLabel("导入 JSON（密钥字段会排除；地址内凭据会拒绝）"));importText=new QPlainTextEdit;importText->setObjectName("aiImport");importText->setMaximumHeight(110);layout->addWidget(importText);auto imports=new QHBoxLayout;layout->addLayout(imports);auto inspect=new QPushButton("生成安全预览"),exportButton=new QPushButton("导出已保存配置");apply=new QPushButton("确认导入");apply->setObjectName("aiApply");apply->setEnabled(false);imports->addWidget(inspect);imports->addWidget(apply);imports->addWidget(exportButton);
 evidence=new QPlainTextEdit;evidence->setObjectName("aiEvidence");evidence->setReadOnly(true);evidence->setMinimumHeight(220);layout->addWidget(evidence);
 setStyleSheet("#aiSettingsPage QPushButton{min-height:32px;padding:4px 10px;}#aiSettingsPage QLineEdit,#aiSettingsPage QComboBox{min-height:30px;}#aiSettingsPage QComboBox QAbstractItemView{selection-color:white;selection-background-color:#244f86;}");
 try{saved=store.read();fill(saved.value("preferences").toObject());}catch(...){saved=aiSettings::empty();fill(saved.value("preferences").toObject());setHostError(error());}refresh();
 auto changed=[this]{invalidate();};connect(provider,&QComboBox::currentIndexChanged,this,changed);connect(model,&QLineEdit::textChanged,this,changed);connect(endpoint,&QLineEdit::textChanged,this,changed);connect(timeout,&QSpinBox::valueChanged,this,changed);connect(tokens,&QSpinBox::valueChanged,this,changed);connect(temperature,&QDoubleSpinBox::valueChanged,this,changed);connect(sendTemperature,&QCheckBox::toggled,this,changed);connect(enabled,&QCheckBox::toggled,this,changed);connect(importText,&QPlainTextEdit::textChanged,this,[this]{invalidate();});
 connect(save,&QPushButton::clicked,this,[this]{try{auto next=store.save(draft(),saved.value("capabilities").toArray(),saved.value("revision").toDouble());saved=next;invalidate();refresh();message->setText("非敏感配置已保存并读回；接口仍未验证");emit configurationSaved(savedConfig());}catch(...){setHostError(error());}});
 connect(cancel,&QPushButton::clicked,this,[this]{try{auto next=store.read();saved=next;fill(savedConfig());importText->clear();invalidate();refresh();message->setText("草稿已取消，已重读保存配置");}catch(...){setHostError(error());}});
 connect(inspect,&QPushButton::clicked,this,[this]{previewImport(importText->toPlainText().toUtf8());});connect(apply,&QPushButton::clicked,this,[this]{try{aiSettings::require(!preview.isEmpty(),"预览已失效");saved=store.save(preview.value("preferences").toObject(),preview.value("capabilities").toArray(),preview.value("expectedRevision").toDouble());fill(savedConfig());importText->clear();invalidate();refresh();message->setText("安全配置已导入；密钥及连通声明未导入");emit configurationSaved(savedConfig());}catch(...){setHostError(error());}});
 connect(exportButton,&QPushButton::clicked,this,[this]{auto path=QFileDialog::getSaveFileName(this,"导出非敏感配置",{},"JSON (*.json)");if(path.isEmpty())return;QSaveFile f(path);auto bytes=exportArchive();if(!f.open(QIODevice::WriteOnly)||f.write(bytes)!=bytes.size()||!f.commit())setHostError("导出文件写入失败");else message->setText("已导出非敏感配置");});connect(handoff,&QPushButton::clicked,this,&AiSettingsPage::openManualHandoff);
}
QJsonObject AiSettingsPage::draft()const{return aiSettings::preferences({{"provider",provider->currentData().toString()},{"model",model->text()},{"endpoint",endpoint->text()},{"timeoutMs",timeout->value()},{"maxCompletionTokens",tokens->value()},{"temperature",temperature->value()>=0?QJsonValue(temperature->value()):QJsonValue(QJsonValue::Null)},{"sendTemperature",sendTemperature->isChecked()},{"enabledPreference",enabled->isChecked()}});}
void AiSettingsPage::fill(const QJsonObject& p){provider->setCurrentIndex(provider->findData(p.value("provider").toString()));model->setText(p.value("model").toString());endpoint->setText(p.value("endpoint").toString());timeout->setValue(p.value("timeoutMs").toInt(120000));tokens->setValue(p.value("maxCompletionTokens").toInt(4096));temperature->setValue(p.value("temperature").isDouble()?p.value("temperature").toDouble():-0.01);sendTemperature->setChecked(p.value("sendTemperature").toBool());enabled->setChecked(p.value("enabledPreference").toBool());}
void AiSettingsPage::invalidate(){preview={};apply->setEnabled(false);}
void AiSettingsPage::refresh(){auto p=savedConfig();QString text="已保存配置："+QString(p.value("provider")=="manual-handoff"?"手动交接模式":(aiSettings::status(p).value("configuration")=="configured"?"字段完整":"字段未完整"))+"\n密钥存储与执行接口：尚未连接\n网络授权：未授权；连通检查：未测试\n";text+="本地保存与读回："+(saved.value("savedAt").isString()?saved.value("savedAt").toString():QString("暂无记录"))+"\n手动研究交接入口："+(handoff->isEnabled()?QString("主页面已连接（登录及研究结果未验证）"):QString("主页面尚未连接"))+"\n\n模型能力声明\n来源：services/modelRegistryService.js；来源观察时间、运行验证时间：未知\n";for(auto v:aiSettings::declarations())text+=aiSettings::capabilityName(v.toObject().value("id").toString())+"：代码声明，当前原生运行未验证\n";for(auto group:{saved.value("capabilities").toArray(),hostReports})for(auto v:group){auto o=v.toObject();text+="\n"+aiSettings::capabilityName(o.value("id").toString())+"：来源报告（未验证）\n来源："+o.value("source").toString()+"；原声明："+o.value("claimedStatus").toString()+"\n接收时间："+o.value("importedAt").toString()+"；运行验证时间：未知\n";}evidence->setPlainText(text);}
QJsonObject AiSettingsPage::saveState()const{QJsonObject s{{"schema","native-ai-settings-ui/v1"},{"revision",saved.value("revision")}};try{s.insert("draft",draft());}catch(...){s.insert("draft",savedConfig());}if(!preview.isEmpty())s.insert("preview",preview);return s;}
void AiSettingsPage::restoreState(const QJsonObject& s){try{if(s.value("schema")!="native-ai-settings-ui/v1"||s.value("revision")!=saved.value("revision"))return;fill(aiSettings::preferences(s.value("draft").toObject()));invalidate();if(s.value("preview").isObject())previewImport(QJsonDocument(s.value("preview").toObject()).toJson(QJsonDocument::Compact));}catch(...){setHostError(error());}}
void AiSettingsPage::setHostError(const QString&){message->setText(error());}
void AiSettingsPage::previewImport(const QByteArray& bytes){invalidate();try{auto safe=aiSettings::parse(bytes);importText->setPlainText(QString::fromUtf8(QJsonDocument(safe).toJson(QJsonDocument::Indented)));safe.insert("expectedRevision",saved.value("revision"));preview=safe;apply->setEnabled(true);evidence->setPlainText(QString::fromUtf8(QJsonDocument(safe).toJson(QJsonDocument::Indented)));message->setText("预览只保留白名单配置；能力声明未验证。确认后覆盖已保存配置。");}catch(...){importText->clear();setHostError(error());}}
QByteArray AiSettingsPage::exportArchive()const{return QJsonDocument(saved).toJson(QJsonDocument::Indented);}
QJsonObject AiSettingsPage::savedConfig()const{return saved.value("preferences").toObject();}
void AiSettingsPage::setManualHandoffAvailable(bool available){handoff->setEnabled(available);refresh();}
void AiSettingsPage::setHostCapabilities(const QJsonObject& report){try{hostReports=aiSettings::reported(report.value("capabilities").toArray(),"host");refresh();}catch(...){setHostError(error());}}
