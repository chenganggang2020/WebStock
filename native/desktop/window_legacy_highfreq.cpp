#include "window.hpp"
#include "legacy_highfreq.hpp"
#include "legacy_highfreq_page.hpp"
#include "chart.hpp"
#include "quant_parquet_chart.hpp"
#include <QFileInfo>
#include <QLayout>
#include <QPushButton>
#include <QStatusBar>

void Window::legacyHighFrequencyView(){
 auto* page=qobject_cast<LegacyHighFrequencyPage*>(pages.value("legacyHighFrequency"));
 if(!page){
  auto root=QFileInfo(businessStore->filePath()).absolutePath();
  page=new LegacyHighFrequencyPage(root+"/legacy-archive/webstock-snapshot.sqlite",root+"/securities-legacy-v1.sqlite",workspaceTabs);
  page->setProperty("workspace","研究");page->setProperty("pageTitle","旧5秒 / 30秒历史");pages["legacyHighFrequency"]=page;
  connect(page,&LegacyHighFrequencyPage::openOnMainChart,this,[this,page](QJsonObject packet){
   if(!page->isVisible()||workspaceTabs->currentWidget()!=page||isMinimized())return;
   openLegacyHistoryPacket(packet);
  });
 }
 activatePage(page);
}

void Window::openLegacyHistoryPacket(QJsonObject packet){
   try{
    // Revalidate the original frame before changing any host selection.
    legacyHighFrequency::chartRows(packet);
    if(legacyHighFrequencyFrame.isEmpty())legacyHighFrequencyReturnState={{"id",activeId},{"period",period},{"mode",mode},{"samplingSeconds",samplingSeconds}};
    auto id=packet["id"].toString();
    auto target=marketdata::roster({{"schema","native-watchlist/v1"},{"instruments",QJsonArray{QJsonObject{{"id",id},{"name",packet["name"]},{"symbol",id.section(':',0,0).toLower()+id.section(':',2)},{"group","旧历史只读"},{"order",0}}}}})[0].toObject();
    legacyHighFrequencyFrame=packet;activeId=id;samplingSeconds=0;period=quantParquet::isChart(packet)?QString("day"):QString("minute%1s").arg(packet["intervalSeconds"].toInt());instrument=legacyHighFrequency::viewInstrument(target,packet);
    home();mode="focus";arrangeWorkspace();legacyHighFrequency::showOnChart(chart,packet);referenceChart->hide();
    // The external history frame replaced the series without Window::loadChart.
    // Do not let its old input cache suppress restoring the current chart.
    chart->setProperty("stockSeriesInput",{});
    if(quantParquet::isChart(packet))quote->setText(packet.value("name").toString().toHtmlEscaped()+" · "+packet.value("id").toString().toHtmlEscaped()+"<br>"+quantParquet::chartCaption(packet).toHtmlEscaped());
    else quote->setText(QString("<b>%1</b> · %2<br>旧历史 %3 · %4秒桶尾（非今日报价）").arg(packet["name"].toString().toHtmlEscaped(),id.toHtmlEscaped(),packet["tradingDate"].toString()).arg(packet["intervalSeconds"].toInt()));
    quote->setToolTip(legacyHighFrequency::caption(packet));snapshot->setText(legacyHighFrequency::caption(packet));bookState->setText("旧历史只读 · 不混入当前五档");bookRows->clear();dataState->setText(legacyHighFrequency::caption(packet));
    if(!legacyHighFrequencyReturnButton){legacyHighFrequencyReturnButton=new QPushButton("返回进入前的当前资料",centerPanel);legacyHighFrequencyReturnButton->setObjectName("legacyHighFrequencyReturnCurrent");centerPanel->layout()->addWidget(legacyHighFrequencyReturnButton);connect(legacyHighFrequencyReturnButton,&QPushButton::clicked,this,[this]{
      if(legacyHighFrequencyFrame.isEmpty())return;auto prior=legacyHighFrequencyReturnState;legacyHighFrequencyFrame={};legacyHighFrequencyReturnState={};legacyHighFrequencyReturnButton->hide();activeId=prior["id"].toString();period=prior["period"].toString("day");mode=prior["mode"].toString("classic");samplingSeconds=prior["samplingSeconds"].toInt();
      if(feed)instruments=feed->instruments;bool found=false;for(auto value:instruments)found|=value.toObject()["id"]==activeId;if(found){loadInstrument(activeId,false);statusBar()->showMessage("已明确退出旧历史，恢复当前资料；原档案未修改。",8000);}else{instrument={};activeId.clear();chart->setSeries({}, {},false);referenceChart->setSeries({}, {},false);quote->setText("进入前的证券已不在当前目录；未恢复或沿用旧历史图");snapshot->clear();bookRows->clear();bookState->setText("无当前证券");dataState->setText("当前资料不可恢复，请重新选择证券");statusBar()->showMessage("已退出旧历史，但进入前证券已移除；主图已清空，请重新选择。",12000);}arrangeWorkspace();if(auto* current=findChild<QPushButton*>("period"+(period.startsWith("minute")?QString("minute"):period)))current->setChecked(true);
    });}
    legacyHighFrequencyReturnButton->show();if(auto* minute=findChild<QPushButton*>(quantParquet::isChart(packet)?"periodday":"periodminute"))minute->setChecked(true);showExplanation(chart->selected);statusBar()->showMessage("旧历史已在原主图打开；刷新、周期和异步行情不会覆盖，需明确返回当前资料。",12000);
   }catch(const std::exception&e){statusBar()->showMessage("旧历史未打开："+QString::fromUtf8(e.what()),12000);}
}
