#pragma once
#include "stock_profile.hpp"

namespace researchPresentation {
inline QString field(QJsonValue value){return stockResearch::display(value).toHtmlEscaped();}
inline QString company(QString id,QJsonObject p,bool historical=false){
 if(id.isEmpty())return "<h2>公司主营</h2><p>请先选择一只股票。</p>";
 if(!stockProfile::supported(id))return "<h2>该标的不是上市公司股票</h2><p>指数和 ETF 不适用公司主营、营收组成等 F10 资料。</p><p>可返回行情查看走势，或选择一只股票查看公司资料。已保存的研究笔记仍保留。</p>";
 if(p.isEmpty())return "<h2>公司资料尚未取得</h2><p>点击「更新公司资料」读取所选股票的信息。</p>";
 QString html="<h2>"+field(p["name"])+" · "+id.section(':',2).toHtmlEscaped()+"</h2><p>"+field(p["companyName"])+"</p>";
 html+="<p>行业："+field(p["industry"])+"　资料时间："+field(p["fetchedAt"])+(historical?"　历史快照":"")+"</p>";
 html+="<h3>主营业务</h3><p>"+field(p["businessSummary"])+"</p><h3>经营范围</h3><p>"+field(p["businessScope"])+"</p>";
 auto items=p["mainBusinessItems"].toArray();
 if(!items.isEmpty()){
  html+="<h3>主营组成</h3><table width='100%' cellspacing='0' cellpadding='8' border='1'><tr><th>业务</th><th>收入占比</th><th>报告日</th></tr>";
  for(auto v:items){auto row=v.toObject();html+="<tr><td>"+field(row["name"])+"</td><td>"+(row["ratio"].isDouble()?QString::number(row["ratio"].toDouble(),'f',2)+"%":QString("占比未提供"))+"</td><td>"+field(row["reportDate"])+"</td></tr>";}
  html+="</table>";
 }else html+="<p>主营组成：未提供</p>";
 QStringList boards;for(auto v:p["boards"].toArray())boards<<field(v);
 if(!boards.isEmpty())html+="<h3>所属板块</h3><p>"+boards.join("　·　")+"</p>";
 QStringList failed;for(auto kind:stockProfile::kinds){auto source=p["sources"].toObject()[kind].toObject();if(source["status"]=="failed"||source["status"]=="cached-after-failure")failed<<QStringList{"公司概况","核心题材","主营分析"}[stockProfile::kinds.indexOf(kind)];}
 if(!failed.isEmpty())html+="<p>更新失败："+failed.join("、")+"。已取得的资料按原日期显示，详情见「来源详情」。</p>";
 return html;
}
inline QString overview(const QJsonObject& b){
 auto q=b["quote"].toObject();QString out=b["name"].toString()+"  "+b["id"].toString().section(':',2)+"\n\n";
 out+="价格  "+stockResearch::display(q["price"])+"    涨跌幅  "+stockResearch::display(q["changePercent"])+"%\n行情时间  "+q["tradeDate"].toString()+" "+q["tradeTime"].toString()+"\n\n";
 out+=QString("关联资料 %1 份\n选择左侧资料阅读全文；手动笔记和历史快照在上方页签中。").arg(b["documents"].toArray().size());
 if(b.contains("acquisitionError"))out+="\n资料读取失败："+b["acquisitionError"].toString();
 return out;
}
}
