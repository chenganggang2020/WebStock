#include "stock_extension_host.hpp"
#include "chart.hpp"
#include "compact_actions.hpp"
#include "appearance.hpp"
#include <QtWidgets>
#include <QVersionNumber>
using namespace quantPlugin;
namespace {
bool chartPlugin(const QJsonObject& m){auto ui=m["ui"].toObject();return ui["apiVersion"]==1&&ui["placement"]=="chart";}
QPixmap preview(const QJsonObject& ui,const appearance::Theme& theme){
  const auto palette=appearance::palette(theme);
  QPixmap image(240,100);image.fill(palette.base().color());QPainter p(&image);p.setRenderHint(QPainter::Antialiasing);
  for(auto v:ui["preview"].toArray()){auto line=v.toObject();auto values=line["values"].toArray();if(values.size()<2||values.size()>128)continue;QPainterPath path;for(int i=0;i<values.size();++i){QPointF at(12+i*216./(values.size()-1),88-qBound(0.,values[i].toDouble(),1.)*76);if(i)path.lineTo(at);else path.moveTo(at);}QColor c(line["color"].toString());p.setPen(QPen(appearance::plotColor(theme,c.isValid()?c:palette.text().color(),line["role"].toString()),2));p.drawPath(path);}return image;
}
}
StockExtensionHost::StockExtensionHost(QString root,Chart* chart,CompactActions* tools,QVBoxLayout* panels,QObject* parent)
 :QObject(parent),repository_(root),chart_(chart),tools_(tools),panels_(panels),offers_(QCoreApplication::applicationDirPath()+"/plugin-packages"){
  setObjectName("stockExtensionHost");synchronize();
}
StockExtensionHost::~StockExtensionHost(){for(auto id:contributions_.keys())stop(id);}
void StockExtensionHost::stop(const QString& id){auto contribution=contributions_.take(id);if(contribution.panel)delete contribution.panel;if(contribution.button)delete contribution.button;if(chart_)chart_->removeExtensionLayer(id);}
void StockExtensionHost::synchronize(){
  QSet<QString> retained;
  try{for(auto v:repository_.plugins()){
    auto p=v.toObject();const auto id=p["id"].toString();
    try{p=repository_.plugin(id);auto m=p["manifest"].toObject();if(!p["enabled"].toBool()||!chartPlugin(m))continue;retained.insert(id);
      if(contributions_.contains(id)&&contributions_[id].signature==p["manifestSha256"].toString())continue;
      stop(id);auto button=new QPushButton(m["ui"].toObject()["toolbarLabel"].toString(m["ui"].toObject()["title"].toString()));button->setObjectName("extensionAction_"+id);button->setCheckable(true);button->setToolTip(m["ui"].toObject()["summary"].toString());tools_->addWidget(button);appearance::setIcon(button,"strategy");
      contributions_[id]={button,nullptr,p["manifestSha256"].toString()};connect(button,&QPushButton::toggled,this,[this,id](bool on){if(on)open(id);else if(contributions_.value(id).panel)contributions_[id].panel->hide();});
    }catch(const std::exception&e){retained.remove(id);emit error(QString::fromUtf8(e.what()));}
  }}catch(const std::exception&e){emit error(QString::fromUtf8(e.what()));}
  for(auto id:contributions_.keys())if(!retained.contains(id))stop(id);
  emit changed();
}
void StockExtensionHost::refreshAppearance(){
  for(auto& c:contributions_)if(c.button)appearance::setIcon(c.button,"strategy");
  if(!manager_)return;
  const auto theme=appearance::of(manager_);manager_->setPalette(appearance::palette(theme));
  appearance::refreshIcons(manager_);
  for(auto* picture:manager_->findChildren<QLabel*>())if(picture->property("appearancePreview").isValid())picture->setPixmap(preview(picture->property("appearancePreview").toJsonObject(),theme));
}
void StockExtensionHost::setContext(const QJsonObject& input){context_=input;for(auto&c:contributions_)if(c.panel)c.panel->setContext(input);}
void StockExtensionHost::open(const QString& id){
  try{require(contributions_.contains(id),"插件未安装或未启用");emit dayRequested();auto&c=contributions_[id];
    if(!c.panel){
      c.panel=new StockExtensionPanel(repository_.root(),id,chart_,panels_->parentWidget());
      connect(c.panel,&StockExtensionPanel::refreshRequested,this,&StockExtensionHost::refreshRequested);
      connect(c.panel,&StockExtensionPanel::visibilityChanged,this,[button=QPointer<QPushButton>(c.button)](bool visible){if(button){QSignalBlocker block(button);button->setChecked(visible);}});
    }
    c.panel->setContext(context_);c.panel->show();c.panel->raise();c.panel->activateWindow();QSignalBlocker block(c.button);c.button->setChecked(true);
  }catch(const std::exception&e){if(contributions_.contains(id)&&contributions_[id].button){QSignalBlocker block(contributions_[id].button);contributions_[id].button->setChecked(false);}emit error(QString::fromUtf8(e.what()));}
}
void StockExtensionHost::install(const QByteArray& package){auto m=validateManifest(object(package)["manifest"].toObject());require(chartPlugin(m),"此插件包尚未适配当前图表扩展接口");stop(m["id"].toString());try{repository_.install(package);}catch(...){synchronize();throw;}synchronize();}
void StockExtensionHost::setEnabled(const QString& id,bool enabled){stop(id);try{repository_.configure(id,repository_.runtimeFor(id),enabled);}catch(...){synchronize();throw;}synchronize();}
void StockExtensionHost::uninstall(const QString& id,bool keepHistory){stop(id);try{repository_.uninstall(id,keepHistory);}catch(...){synchronize();throw;}synchronize();}
void StockExtensionHost::showManager(){
  if(manager_){manager_->show();manager_->raise();manager_->activateWindow();return;}
  auto d=new QDialog(qobject_cast<QWidget*>(parent()));manager_=d;d->setAttribute(Qt::WA_DeleteOnClose);d->setObjectName("stockPluginManager");d->setWindowTitle("设置 · 插件");d->resize(920,650);d->ensurePolished();
  auto layout=new QVBoxLayout(d);layout->setContentsMargins(18,18,18,18);layout->setSpacing(12);
  auto bar=new QHBoxLayout;auto title=new QLabel("插件");QFont titleFont=title->font();titleFont.setPointSize(16);title->setFont(titleFont);bar->addWidget(title);bar->addStretch();auto search=new QLineEdit;search->setPlaceholderText("搜索功能");search->setObjectName("pluginSearch");bar->addWidget(search);auto installedOnly=new QCheckBox("已安装");bar->addWidget(installedOnly);auto import=new QPushButton("导入插件包");bar->addWidget(import);layout->addLayout(bar);appearance::setIcon(import,"data");
  auto area=new QScrollArea;area->setWidgetResizable(true);area->setFrameShape(QFrame::NoFrame);auto content=new QWidget;auto cards=new QVBoxLayout(content);area->setWidget(content);layout->addWidget(area,1);auto status=new QLabel;status->setWordWrap(true);status->setObjectName("pluginManagerStatus");layout->addWidget(status);
  auto refresh=std::make_shared<std::function<void()>>();
  *refresh=[this,d,cards,status,search,installedOnly]{
    while(auto item=cards->takeAt(0)){if(item->widget())item->widget()->deleteLater();delete item;}
    QMap<QString,QJsonObject> entries;QMap<QString,QByteArray> packages;int older=0;
    try{
      for(auto v:repository_.plugins()){auto p=v.toObject();try{p=repository_.plugin(p["id"].toString());auto m=p["manifest"].toObject();if(chartPlugin(m))entries[m["id"].toString()]={{"manifest",m},{"installed",true},{"enabled",p["enabled"]},{"installedVersion",m["version"]}};else ++older;}catch(const std::exception&e){status->setText(QString::fromUtf8(e.what()));}}
      for(const auto& dir:QStringList{offers_,repository_.root()+"/offers"})for(const auto& file:QDir(dir).entryList({"*.wspkg"},QDir::Files)){
        try{auto bytes=read(dir+"/"+file);auto m=validateManifest(object(bytes)["manifest"].toObject());if(!chartPlugin(m))continue;const auto id=m["id"].toString();auto old=entries[id];auto current=old["manifest"].toObject();if(current.isEmpty()||QVersionNumber::fromString(m["version"].toString())>=QVersionNumber::fromString(current["version"].toString())){old["manifest"]=m;entries[id]=old;packages[id]=bytes;}}catch(const std::exception&){/* Invalid offers never become installable. */}
      }
      for(auto it=entries.begin();it!=entries.end();++it){auto e=it.value(),m=e["manifest"].toObject(),ui=m["ui"].toObject();const auto id=it.key();bool installed=e["installed"].toBool(),enabled=e["enabled"].toBool();if(installedOnly->isChecked()&&!installed)continue;if(!(ui["title"].toString()+ui["summary"].toString()+m["name"].toString()).contains(search->text(),Qt::CaseInsensitive))continue;
        auto card=new QFrame;card->setObjectName("pluginCard_"+id);card->setFrameShape(QFrame::StyledPanel);auto row=new QHBoxLayout(card);auto picture=new QLabel;picture->setProperty("appearancePreview",ui);picture->setPixmap(preview(ui,appearance::of(d)));picture->setAccessibleName("插件效果示意");picture->setFixedSize(240,100);row->addWidget(picture);auto info=new QVBoxLayout;auto heading=new QLabel(ui["title"].toString());heading->setTextFormat(Qt::PlainText);QFont f=heading->font();f.setPointSize(12);heading->setFont(f);info->addWidget(heading);auto desc=new QLabel(ui["summary"].toString());desc->setTextFormat(Qt::PlainText);desc->setWordWrap(true);info->addWidget(desc);
        auto controls=new QHBoxLayout;auto primary=new QPushButton(installed?(enabled?"打开":"启用"):"安装");primary->setObjectName("pluginPrimary_"+id);primary->setEnabled(installed||packages.contains(id));controls->addWidget(primary);
        if(installed&&packages.contains(id)&&QVersionNumber::fromString(m["version"].toString())>QVersionNumber::fromString(e["installedVersion"].toString())){
          auto update=new QPushButton("更新");update->setObjectName("pluginUpdate_"+id);controls->addWidget(update);
          connect(update,&QPushButton::clicked,d,[this,status,bytes=packages[id]]{try{install(bytes);status->clear();}catch(const std::exception&e){status->setText(QString::fromUtf8(e.what()));}});
        }
        auto toggle=new QPushButton("停用");toggle->setVisible(installed&&enabled);toggle->setObjectName("pluginDisable_"+id);controls->addWidget(toggle);auto uninstall=new QPushButton("卸载");uninstall->setVisible(installed);uninstall->setObjectName("pluginUninstall_"+id);controls->addWidget(uninstall);auto details=new QPushButton("详情");controls->addWidget(details);controls->addStretch();auto state=new QLabel(installed?(enabled?"已启用":"已停用"):"可安装");controls->addWidget(state);info->addLayout(controls);row->addLayout(info,1);cards->addWidget(card);
        auto action=[this,status](std::function<void()> fn){try{fn();status->clear();}catch(const std::exception&e){status->setText(QString::fromUtf8(e.what()));}};
        connect(primary,&QPushButton::clicked,d,[this,d,action,installed,enabled,id,bytes=packages.value(id)]{action([&]{if(!installed)install(bytes);else if(!enabled)setEnabled(id,true);else{open(id);d->hide();}});});
        connect(toggle,&QPushButton::clicked,d,[this,action,id]{action([&]{setEnabled(id,false);});});
        connect(uninstall,&QPushButton::clicked,d,[this,d,action,id]{QMessageBox prompt(QMessageBox::Question,"卸载插件","移除插件及其图层、入口和面板。共享行情保留。",QMessageBox::NoButton,d);auto keep=new QCheckBox("保留历史结果和参数");keep->setChecked(true);prompt.setCheckBox(keep);auto remove=prompt.addButton("卸载",QMessageBox::AcceptRole);prompt.addButton("取消",QMessageBox::RejectRole);prompt.exec();if(prompt.clickedButton()==remove)action([&]{this->uninstall(id,keep->isChecked());});});
        connect(details,&QPushButton::clicked,d,[this,d,m,id]{auto info=new QDialog(d);info->setAttribute(Qt::WA_DeleteOnClose);info->setWindowTitle("插件详情");auto l=new QVBoxLayout(info);auto text=new QTextBrowser;QString runtime=repository_.runtimeFor(id);text->setPlainText(m["name"].toString()+"\n版本 "+m["version"].toString()+"\n许可 "+m["license"].toString()+"\n\n"+m["ui"].toObject()["rules"].toString()+"\n\n运行环境："+(runtime.isEmpty()?"尚未准备":runtime));l->addWidget(text);if(runtime.isEmpty()){auto choose=new QPushButton("选择已有运行环境");l->addWidget(choose);connect(choose,&QPushButton::clicked,info,[this,info,id,text]{auto file=QFileDialog::getOpenFileName(info,"选择 Python 运行环境",{},"Python (python.exe)");if(file.isEmpty())return;try{repository_.configure(id,file,true);synchronize();info->accept();}catch(const std::exception&e){text->setPlainText(QString::fromUtf8(e.what()));}});}info->resize(600,400);info->show();});
      }
      if(!cards->count()){auto empty=new QLabel("没有可用插件，可导入 .wspkg 插件包");empty->setAlignment(Qt::AlignCenter);cards->addWidget(empty);}cards->addStretch();
      if(older)status->setText(QString("%1 个旧插件尚未适配新接口，原文件和历史保留。").arg(older));
    }catch(const std::exception&e){status->setText(QString::fromUtf8(e.what()));}
  };
  connect(this,&StockExtensionHost::changed,d,[refresh]{(*refresh)();});connect(search,&QLineEdit::textChanged,d,[refresh]{(*refresh)();});connect(installedOnly,&QCheckBox::toggled,d,[refresh]{(*refresh)();});
  connect(import,&QPushButton::clicked,d,[this,d,status]{auto file=QFileDialog::getOpenFileName(d,"安装插件包",{},"WebStock 插件 (*.wspkg)");if(file.isEmpty())return;try{auto bytes=read(file);auto m=validateManifest(object(bytes)["manifest"].toObject());require(chartPlugin(m),"该插件包未适配当前扩展接口");QDir().mkpath(repository_.root()+"/offers");write(repository_.root()+"/offers/"+m["id"].toString()+"-"+m["version"].toString()+".wspkg",bytes);install(bytes);}catch(const std::exception&e){status->setText(QString::fromUtf8(e.what()));}});
  (*refresh)();d->show();
}
