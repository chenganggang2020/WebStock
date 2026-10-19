#pragma once
#include "quant_research_model.hpp"
#include "page_snapshot_reader.hpp"
#include <QComboBox>
#include <QFile>
#include <QFileInfo>
#include <QFormLayout>
#include <QHideEvent>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QPlainTextEdit>
#include <QProcess>
#include <QPushButton>
#include <QTableWidget>
#include <QHeaderView>
#include <QVBoxLayout>

class QuantParquetWidget final:public QWidget {
 QJsonObject catalog,settings,last;
 QComboBox* groups;QListWidget* securities;QLineEdit *start,*end,*code,*fold,*factor;
 QTableWidget* table;QPlainTextEdit* details;QLabel* status;
 QPushButton *load,*input,*chart,*previous,*next,*inspect,*counterpart;QProcess* process=new QProcess(QCoreApplication::instance());
 PageSnapshotReader* snapshotReader=nullptr;QJsonObject deferredState;QString metadataText;int metadataOffset=0;QLabel* metadataPosition=nullptr;QByteArray requestBytes;
 QByteArray output,errors;QString purpose;int offset=0;bool cancelled=false;
 std::function<void(QByteArray)> inputOpener;
 std::function<void(QJsonObject)> chartOpener;
 static QByteArray read(QString path,int limit){QFile file(path);quantParquet::need(file.open(QIODevice::ReadOnly)&&file.size()<=limit,"Parquet配置/索引不可读或超限："+path);return file.readAll();}
 QJsonObject group()const{int i=groups->currentIndex();auto array=catalog.value("groups").toArray();return i>=0&&i<array.size()?array[i].toObject():QJsonObject{};}
 void renderMetadata(){int begin=metadataOffset,end=std::min(begin+24000,int(metadataText.size()));if(begin>0&&metadataText[begin].isLowSurrogate())--begin;if(end>0&&end<metadataText.size()&&metadataText[end-1].isHighSurrogate())--end;details->setPlainText(metadataText.mid(begin,end-begin));if(metadataPosition)metadataPosition->setText(QString("原文 %1–%2 / %3 字符，完整保留").arg(begin).arg(end).arg(metadataText.size()));}
 void setMetadata(const QJsonObject& value){metadataText=QString::fromUtf8(QJsonDocument(value).toJson(QJsonDocument::Indented));metadataOffset=0;renderMetadata();}
 void guard(std::function<void()> fn){try{fn();}catch(const std::exception& error){status->setText(QString::fromUtf8(error.what()));}}
 void choose(){
  stop();offset=0;last={};purpose.clear();table->setRowCount(0);securities->clear();auto g=group();auto original=g.value("original").toObject();auto range=original.value("dateRange").toObject();if(range.isEmpty())range=original.value("requestedDateRange").toObject();
  start->setText(range.value("start").toString("1900-01-01"));end->setText(g.value("asOf").toString(range.value("end").toString("2099-12-31")));code->clear();fold->clear();factor->clear();
  QMap<QString,QJsonObject> declarations;for(auto value:original.value("files").toArray()){auto spec=value.toObject();declarations[g.value("id").toString()+"/"+spec.value("path").toString()]=spec;}
  int valid=0,unresolved=0;for(auto value:catalog.value("files").toArray()){auto f=value.toObject();if(f.value("group")!=g.value("id"))continue;if(g.value("kind")=="prices"||g.value("kind")=="recovery"){
   auto identity=f.value("identity").toObject();auto declared=declarations.value(f.value("path").toString());bool allowed=f.value("valid").toBool()&&!identity.value("id").toString().isEmpty()&&g.value("kind")=="prices";
   if(f.value("valid").toBool())valid++;if(identity.value("id").toString().isEmpty())unresolved++;
   auto item=new QListWidgetItem(f.value("code").toString(declared.value("code").toString())+" "+f.value("name").toString(declared.value("name").toString())+" · "+identity.value("market").toString("市场未确认")+QString(" · %1行").arg(f.value("rows").toInt())+(f.value("valid").toBool()?"":" · 价格校验未通过（身份仅清单声明）")+(allowed?"":" · 禁止作为输入"),securities);
   if(identity.value("type")=="etf")item->setText(item->text()+" · ETF：阅读/主图可用，非股票策略输入");
   if(identity.contains("directoryName")&&identity.value("directoryName")!=f.value("name"))item->setText(item->text()+" · 目录名："+identity.value("directoryName").toString()+"（原名保留）");
   item->setData(Qt::UserRole,f.value("code").toString(declared.value("code").toString()));item->setData(Qt::UserRole+1,f.value("path"));item->setData(Qt::UserRole+2,allowed);item->setData(Qt::UserRole+3,identity.value("type"));item->setData(Qt::UserRole+4,f);
  }}
  bool prices=g.value("kind")=="prices",scores=g.value("kind")=="predictions"||g.value("kind")=="factors";securities->setVisible(prices||g.value("kind")=="recovery");inspect->setEnabled(prices||g.value("kind")=="recovery");input->setEnabled(prices);chart->setEnabled(prices&&bool(chartOpener));load->setEnabled(prices||scores);previous->setEnabled(scores);next->setEnabled(scores);factor->setEnabled(g.value("kind")=="factors");code->setEnabled(scores);fold->setEnabled(scores);
  counterpart->setVisible(g.value("kind")=="recovery");
  setMetadata(original);status->setText(QString("%1 · %2 · %3文件 / %4行 · 有效价格%5，身份未确认%6\nasOf %7 · 日频%8 · 复权%9 · 原始量纲未核实；恢复资料不能作为完整输入").arg(g.value("kind").toString(),g.value("status").toString()).arg(g.value("parquetCount").toInt()).arg(g.value("rowCount").toDouble(),0,'f',0).arg(valid).arg(unresolved).arg(g.value("asOf").toString("未声明"),g.value("period").toString("不适用"),g.value("adjustmentMode").toString("不适用")));
 }
 void openCounterpart(){
  quantParquet::need(group().value("kind")=="recovery"&&securities->selectedItems().size()==1,"请选择一份恢复片段");
  auto path=securities->selectedItems()[0]->data(Qt::UserRole+1).toString();QJsonObject source,target;
  for(auto v:catalog.value("files").toArray())if(v.toObject().value("path")==path)source=v.toObject();
  auto link=source.value("sealedCounterpart").toObject();
  for(auto v:catalog.value("files").toArray())if(v.toObject().value("path")==link.value("path"))target=v.toObject();
  quantParquet::need(!target.isEmpty()&&target.value("kind")=="prices"&&target.value("group")==link.value("group")&&source.value("sha256")==target.value("sha256")&&target.value("sha256")==link.value("sha256")&&source.value("code")==target.value("code")&&source.value("name")==target.value("name"),"没有唯一同内容封账凭据；原片段保留");
  auto gs=catalog.value("groups").toArray();for(int i=0;i<gs.size();i++)if(gs[i].toObject().value("id")==target.value("group")){groups->setCurrentIndex(i);break;}
  securities->clearSelection();for(int i=0;i<securities->count();i++)if(securities->item(i)->data(Qt::UserRole+1).toString()==target.value("path").toString()){securities->item(i)->setSelected(true);securities->scrollToItem(securities->item(i));break;}
  status->setText("已定位原字节相同的封账版本；请明确核验读取/输入/打开日线。原取消任务与片段状态未变，未重启任务；未确认身份仍阻断。");
 }
 void showRows(const QJsonObject& response){auto columns=response.value("columns").toArray(),rows=response.value("rows").toArray();table->clear();table->setColumnCount(columns.size());QStringList labels;for(auto column:columns)labels<<column.toString();table->setHorizontalHeaderLabels(labels);table->setRowCount(rows.size());for(int i=0;i<rows.size();i++){auto row=rows[i].toObject();for(int j=0;j<columns.size();j++){auto v=row.value(columns[j].toString());QString text=v.isNull()?"缺失（原值）":v.isDouble()?QString::number(v.toDouble(),'g',17):v.toString();table->setItem(i,j,new QTableWidgetItem(text));}}table->resizeColumnsToContents();}
 void request(QString destination,int page=0){
  quantParquet::need(process->state()==QProcess::NotRunning,"核验读取尚未结束");auto g=group();quantParquet::need(!g.isEmpty()&&!settings.isEmpty(),"没有已配置的Parquet索引");
  QJsonObject request{{"group",g.value("id")},{"start",start->text()},{"end",end->text()}};bool prices=g.value("kind")=="prices";
  if(destination=="inspect"){auto items=securities->selectedItems();quantParquet::need(items.size()==1,"原始行检查一次选择一份原件");request["action"]="inspect";request["file"]=items[0]->data(Qt::UserRole+1).toString();request["offset"]=page;}
  else if(prices){QJsonArray codes;for(auto* item:securities->selectedItems()){quantParquet::need(item->data(Qt::UserRole+2).toBool(),"所选资料未通过价格或身份核验；可检查原始行，不能作为Quant/图表输入");if(destination=="input")quantParquet::need(item->data(Qt::UserRole+3).toString()=="stock","ETF日线可在量化资料页阅读及原主图查看；当前股票策略不接受ETF输入，未修改原策略范围");codes.append(item->data(Qt::UserRole).toString());}quantParquet::need(!codes.isEmpty(),"明确选择证券后再读取");if(destination=="chart")quantParquet::need(codes.size()==1,"主图一次明确选择一只证券");request["action"]="prices";request["codes"]=codes;}
  else{quantParquet::need(g.value("kind")=="predictions"||g.value("kind")=="factors","取消恢复/未知资料不作为业务输入");request["action"]="scores";request["code"]=code->text();request["fold"]=fold->text();request["factorId"]=factor->text();request["offset"]=page;}
  purpose=destination;offset=page;cancelled=false;output.clear();errors.clear();status->setText("只读核验原始清单与附件，正在读取明确范围…");
  quantParquet::need(!snapshotReader->busy(),"正在重读索引，请稍后再核验范围");process->setProgram(settings.value("python").toString());process->setArguments({"-I","-B",settings.value("script").toString(),"--catalog",settings.value("catalog").toString()});requestBytes=QJsonDocument(request).toJson(QJsonDocument::Compact);process->start();
 }
 void finished(int exit,QProcess::ExitStatus state){
  output+=process->readAllStandardOutput();errors+=process->readAllStandardError();if(cancelled)return;
  if(exit!=0||state!=QProcess::NormalExit){status->setText("未读取或保存："+QString::fromUtf8(errors.left(6000)));return;}
  guard([this]{quantParquet::need(output.size()<=32*1024*1024,"Parquet响应超限，未截断使用");last=quantResearch::parse(output);quantParquet::need(last.value("schema")=="quant-parquet-response/v1","未知Parquet响应");showRows(last);
   if(last.value("kind")=="inspection"){previous->setEnabled(true);next->setEnabled(true);auto info=last;info.remove("rows");info.remove("original");setMetadata(info);status->setText(QString("原始行检查 · %1 · 第%2–%3 / %4行 · 异常行%5 · SHA %6\n保留原值；此检查不产生Quant数据包、不打开价格图、不恢复任务。").arg(last.value("file").toString()).arg(offset+1).arg(offset+last.value("rows").toArray().size()).arg(last.value("total").toInt()).arg(last.value("invalidRowCount").toInt()).arg(last.value("sourceFileSha256").toString()));return;}
   auto data=last.value("dataset").toObject();if(!data.isEmpty())quantResearch::readBars(data);
   status->setText(QString("已核验 %1 · %2 至 %3 · 显示%4–%5 / 所选范围共%6行；源组共%7行\n%8 · asOf %9 · 原始成交量单位未核实；历史研究结果，未启动训练").arg(group().value("id").toString(),start->text(),end->text()).arg(last.value("rows").toArray().isEmpty()?0:offset+1).arg(offset+last.value("rows").toArray().size()).arg(last.value("total").toDouble(),0,'f',0).arg(group().value("rowCount").toDouble(),0,'f',0).arg(group().value("adjustmentMode").toString("分数，不是价格"),group().value("asOf").toString()));
   auto meta=last.value("original").toObject();if(!meta.isEmpty()){setMetadata(meta);status->setText(status->text()+QString("\n原输入：%1 · %2 · asOf %3；证券市场逐行显示，未确认保留缺失").arg(last.value("sourceDataPeriod").toString(),last.value("sourceDataAdjustmentMode").toString(),last.value("sourceDataAsOf").toString()));}
   if(purpose=="input"){quantParquet::need(bool(inputOpener),"当前宿主没有Quant输入接线");inputOpener(QJsonDocument(data).toJson(QJsonDocument::Compact));}
   if(purpose=="chart"){auto packet=last.value("chart").toObject();quantParquet::need(bool(chartOpener)&&!packet.isEmpty(),"当前选择不能打开主图");packet["dataset"]=data;chartOpener(packet);}
  });
 }
public:
 QuantParquetWidget(QString dataRoot,std::function<void(QByteArray)> openInput,QWidget* parent=nullptr):QWidget(parent),inputOpener(openInput){
  auto layout=new QVBoxLayout(this);auto note=new QLabel("旧Parquet业务资料 · 价格用于Quant输入和主图；因子/预测按run、日期、fold筛选。\n原文件只读；模型产物不反序列化；不恢复训练或计划。原始成交量未统一量纲，结果仅供历史探索。");note->setWordWrap(true);layout->addWidget(note);
  groups=new QComboBox;groups->setObjectName("parquetGroup");layout->addWidget(groups);securities=new QListWidget;securities->setObjectName("parquetSecurities");securities->setSelectionMode(QAbstractItemView::ExtendedSelection);securities->setMaximumHeight(180);layout->addWidget(securities);
  auto form=new QFormLayout;auto field=[&](QString label,QString name,QLineEdit*& edit){edit=new QLineEdit;edit->setObjectName(name);form->addRow(label,edit);};field("开始日期","parquetStart",start);field("结束日期","parquetEnd",end);field("分数证券代码（留空=全范围）","parquetCode",code);field("fold（留空=全部）","parquetFold",fold);field("factorId（留空=全部）","parquetFactor",factor);layout->addLayout(form);
  auto actions=new QHBoxLayout;auto button=[&](QString text,QString name,std::function<void()> fn){auto b=new QPushButton(text);b->setObjectName(name);actions->addWidget(b);connect(b,&QPushButton::clicked,this,[this,fn]{guard(fn);});return b;};
  load=button("核验并查看所选范围","parquetLoad",[this]{request("view");});input=button("预览为Quant输入","parquetInput",[this]{request("input");});chart=button("在原主图打开日线","parquetChart",[this]{request("chart");});inspect=button("检查原始行","parquetInspect",[this]{request("inspect");});previous=button("上一页","parquetPrevious",[this]{request(purpose=="inspect"?"inspect":"view",std::max(0,offset-500));});next=button("下一页","parquetNext",[this]{quantParquet::need(offset+500<last.value("total").toInt(),"已经是最后一页");request(purpose=="inspect"?"inspect":"view",offset+500);});button("取消读取","parquetCancel",[this]{stop();status->setText("已取消；没有保存或训练");});layout->addLayout(actions);
  counterpart=new QPushButton("定位已封账的同内容版本（不恢复旧任务）");counterpart->setObjectName("parquetCounterpart");layout->addWidget(counterpart);connect(counterpart,&QPushButton::clicked,this,[this]{guard([this]{openCounterpart();});});
  table=new QTableWidget;table->setObjectName("parquetRows");table->setEditTriggers(QAbstractItemView::NoEditTriggers);layout->addWidget(table,3);details=new QPlainTextEdit;details->setObjectName("parquetMetadata");details->setReadOnly(true);details->setMaximumHeight(150);layout->addWidget(details,1);status=new QLabel;status->setObjectName("parquetStatus");status->setWordWrap(true);layout->addWidget(status);
  connect(securities,&QListWidget::itemSelectionChanged,this,[this]{stop();offset=0;last={};table->setRowCount(0);});for(auto* field:{start,end,code,fold,factor})connect(field,&QLineEdit::textEdited,this,[this]{stop();offset=0;last={};table->setRowCount(0);});
  connect(groups,&QComboBox::currentIndexChanged,this,[this]{choose();});connect(process,&QProcess::readyReadStandardOutput,this,[this]{output+=process->readAllStandardOutput();if(output.size()>32*1024*1024){stop();status->setText("响应超过32MiB，已取消；请缩小明确范围");}});connect(process,&QProcess::readyReadStandardError,this,[this]{errors+=process->readAllStandardError();if(errors.size()>1024*1024){stop();status->setText("读取错误输出超限，已取消");}});connect(process,&QProcess::finished,this,[this](int exit,QProcess::ExitStatus state){finished(exit,state);});connect(process,&QProcess::errorOccurred,this,[this](QProcess::ProcessError error){if(!cancelled&&error==QProcess::FailedToStart)status->setText("本机Arrow解释器不可用；未启动任何研究任务");});
  connect(process,&QProcess::started,this,[this]{if(cancelled){process->kill();return;}process->write(requestBytes);process->closeWriteChannel();});
  securities->setMouseTracking(true);connect(securities,&QListWidget::itemEntered,this,[](QListWidgetItem* item){if(item->toolTip().isEmpty())item->setToolTip(QString::fromUtf8(QJsonDocument(item->data(Qt::UserRole+4).toJsonObject()).toJson(QJsonDocument::Indented)));});
  auto metadataNav=new QHBoxLayout;auto before=new QPushButton("原文上一段"),after=new QPushButton("原文下一段");metadataPosition=new QLabel;metadataNav->addWidget(before);metadataNav->addWidget(metadataPosition,1);metadataNav->addWidget(after);layout->addLayout(metadataNav);connect(before,&QPushButton::clicked,this,[this]{metadataOffset=std::max(0,metadataOffset-24000);renderMetadata();});connect(after,&QPushButton::clicked,this,[this]{if(metadataOffset+24000<metadataText.size())metadataOffset+=24000;renderMetadata();});
  auto retry=new QPushButton("重读资料索引");retry->setObjectName("parquetReloadIndex");layout->addWidget(retry);
  snapshotReader=new PageSnapshotReader(this,[dataRoot]{auto path=dataRoot+"/quant-parquet-v1/adapter.json";auto settings=quantParquet::object(read(path,1024*1024));quantParquet::need(settings.value("schema")=="quant-parquet-adapter/v1","未知Parquet配置");for(auto key:{"python","script","catalog"})quantParquet::need(QFileInfo(settings.value(key).toString()).isAbsolute(),"Parquet配置必须使用绝对路径");auto script=read(settings.value("script").toString(),1024*1024);quantParquet::need(quantParquet::sha(script)==settings.value("scriptSha256").toString(),"Arrow适配器脚本摘要不一致");auto catalog=quantParquet::object(read(settings.value("catalog").toString(),64*1024*1024));quantParquet::need(catalog.value("schema")=="quant-parquet-catalog/v1","未知Parquet索引");return QJsonObject{{"settings",settings},{"catalog",catalog}};},[this](QJsonObject data,QString error){if(!error.isEmpty()){status->setText("资料索引读取失败："+error+"；已有资料/选择保留，可重读。");return;}auto state=deferredState.isEmpty()?saveState():deferredState;settings=data.value("settings").toObject();catalog=data.value("catalog").toObject();{QSignalBlocker blocked(groups);groups->clear();for(auto value:catalog.value("groups").toArray()){auto g=value.toObject();groups->addItem(g.value("kind").toString()+" / "+g.value("id").toString(),g.value("id"));}int index=groups->findData(state.value("group").toString());groups->setCurrentIndex(index<0?0:index);}choose();restoreState(state);deferredState={};setProperty("parquetSnapshotReady",true);});
  connect(retry,&QPushButton::clicked,this,[this]{stop();status->setText("正在后台重读索引；保留已有资料。");snapshotReader->request();});status->setText("正在后台核验资料索引；可离开页面，未启动任务。");snapshotReader->request();
 }
 ~QuantParquetWidget()override{cancelled=true;QObject::disconnect(process,nullptr,this,nullptr);if(process->state()==QProcess::NotRunning)process->deleteLater();else{QObject::connect(process,&QProcess::finished,process,&QObject::deleteLater);process->kill();}}
 QJsonObject saveState()const{if(catalog.isEmpty())return deferredState;QJsonArray codes;for(auto* item:securities->selectedItems())codes.append(item->data(Qt::UserRole).toString());return {{"group",group().value("id")},{"codes",codes},{"start",start->text()},{"end",end->text()},{"code",code->text()},{"fold",fold->text()},{"factorId",factor->text()}};}
 void restoreState(const QJsonObject& state){if(state.isEmpty())return;if(catalog.isEmpty()){deferredState=state;return;}auto array=catalog.value("groups").toArray();for(int i=0;i<array.size();i++)if(array[i].toObject().value("id")==state.value("group")){groups->setCurrentIndex(i);break;}for(auto pair:{qMakePair(start,QString("start")),qMakePair(end,QString("end")),qMakePair(code,QString("code")),qMakePair(fold,QString("fold")),qMakePair(factor,QString("factorId"))})if(state.value(pair.second).isString())pair.first->setText(state.value(pair.second).toString());auto codes=state.value("codes").toArray();for(int i=0;i<securities->count();i++){auto* item=securities->item(i);item->setSelected(codes.contains(item->data(Qt::UserRole).toString()));}offset=0;last={};table->setRowCount(0);}
 void setChartOpener(std::function<void(QJsonObject)> fn){chartOpener=fn;chart->setEnabled(group().value("kind")=="prices"&&bool(chartOpener));}
 void stop(){cancelled=true;if(process->state()!=QProcess::NotRunning)process->kill();}
protected:
 void hideEvent(QHideEvent* event)override{stop();QWidget::hideEvent(event);}
};
