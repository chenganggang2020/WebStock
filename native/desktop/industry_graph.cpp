#include "industry_graph.hpp"
#include "research_companies.hpp"
#include <QPainter>
#include <QMouseEvent>
IndustryGraph::IndustryGraph(QWidget* p):QWidget(p){setObjectName("industryGraph");setMinimumWidth(1280);}
void IndustryGraph::setRows(const QJsonArray& value){rows=value;arrange();update();}
void IndustryGraph::setSelection(const QString& key){selection=key;update();}
void IndustryGraph::arrange(){boxes.clear();QMap<QString,int> counts;int height=140;for(auto v:rows){auto r=v.toObject();int column=researchCompanies::stages().indexOf(r["stage"].toString());if(column<0)column=5;int row=counts[r["stage"].toString()]++;QRectF rect(8+column*212,72+row*100,202,90);boxes.append({rect,r["key"].toString()});height=std::max(height,int(rect.bottom()+15));}setMinimumHeight(height);}
void IndustryGraph::paintEvent(QPaintEvent*){QPainter p(this);p.setRenderHint(QPainter::Antialiasing);p.fillRect(rect(),palette().color(QPalette::Window));p.setPen(palette().color(QPalette::WindowText));p.drawText(QRect(8,5,1260,25),"环节归属图 · 点击节点看公司/原文 · 不表示公司间供货关系");for(int i=0;i<6;i++)p.drawText(QRect(8+i*212,35,202,25),Qt::AlignCenter,researchCompanies::stageLabels()[i]);for(int i=0;i<boxes.size();i++){auto box=boxes[i];auto r=rows[i].toObject();p.setBrush(box.second==selection?palette().color(QPalette::Highlight):palette().color(QPalette::Base));p.setPen(palette().color(QPalette::Mid));p.drawRoundedRect(box.first,5,5);p.setPen(box.second==selection?palette().color(QPalette::HighlightedText):palette().color(QPalette::Text));QString text=r["companyName"].toString()+"\n"+r["product"].toString()+"\n"+researchCompanies::statusLabel(r["status"].toString());p.drawText(box.first.adjusted(8,4,-8,-4),Qt::TextWordWrap,text);}}
void IndustryGraph::mousePressEvent(QMouseEvent* e){for(auto box:boxes)if(box.first.contains(e->position())){setSelection(box.second);if(selected)selected(box.second);return;}QWidget::mousePressEvent(e);}
