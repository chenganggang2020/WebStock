#pragma once
#include <QColor>
#include <QPalette>
#include <QStringList>
#include <QWidget>
#include <QIcon>
#include <QPainter>
#include <QAbstractButton>

namespace appearance {
struct Theme {
 QString id,name;bool dark;QColor bg,panel,text,muted,border,accent,up,down,selection,button;
 QColor grid,fast,slow,buy,profit,loss;
 int radius=4,fontSize=13;double iconStroke=1.65,lineWidth=1.7;
 bool hollowUp=false,preset=false;
};
inline QStringList presetIds(){return {"paper","space","terminal","clear"};}
inline QStringList legacyIds(){return {"navy","graphite","soft","warm"};}
inline QStringList ids(){return presetIds()+legacyIds();}
inline Theme theme(QString id){
 Theme t;
 if(id=="paper")t={id,"暖纸研读",false,"#fbf9f4","#f3f0e8","#1a1a17","#68665f","#ddd8cb","#1f3c6e","#bb3426","#28732b","#e4e9f0","#fffdfa","#e8e2d4","#2d6a8c","#a56e1f","#296f96","#b93247","#217958",6,13,1.5,1.7,false,true};
 else if(id=="space")t={id,"深空看盘",true,"#0e1116","#131821","#efebe0","#a6abb6","#303847","#a8b8e8","#ff7568","#5bb85b","#28334b","#1a202b","#1f242e","#6eb6e4","#e6a93b","#9ad3ff","#ff8b94","#5bd9b4",7,13,1.65,1.7,false,true};
 else if(id=="terminal")t={id,"蓝灰终端",true,"#131e2c","#192636","#e4edf7","#a9bcd1","#3b5068","#82b9ea","#ff6972","#40c9a2","#20334b","#223349","#26374c","#83c7f5","#f0c66c","#bbdeff","#ff8c9a","#55d8b1",2,13,1.8,1.7,true,true};
 else if(id=="clear")t={id,"明晰高对比",false,"#ffffff","#f0f3f8","#132136","#4f6077","#a3b2c5","#174ea6","#b42340","#08734f","#dce9fc","#ffffff","#e1e7ef","#1558b0","#9b5700","#204a8d","#a7193b","#086448",5,14,2.25,2.2,false,true};
 else if(id=="graphite")t={id,"石墨灰",true,"#181a1f","#252830","#edf0f5","#b1bac8","#657084","#9cbcff","#ff4040","#00d060","#303c52","#30353f"};
 else if(id=="soft")t={id,"柔白蓝",false,"#f8fafc","#e9eef5","#1e2a3b","#526178","#7f8c9f","#175ea8","#ce2438","#00804a","#d6e7fb","#f0f4f9"};
 else if(id=="warm")t={id,"暖米色",false,"#f7f3eb","#eae3d7","#302c27","#645b50","#8b7d69","#875611","#c92536","#007c46","#e9d9b8","#f1e9dc"};
 else t={"navy","深海蓝",true,"#101722","#1c2838","#e6edf5","#a5b4c7","#51647c","#6eb6ff","#ff4040","#00d060","#20364d","#26364b"};
 if(!t.preset){t.grid=t.border;t.fast="#4f87d6";t.slow="#cf982b";t.buy="#9bbce4";t.profit="#ef717a";t.loss="#43b99c";}
 return t;
}
// A dialog has its own window(); resolve the owning widget chain instead.
inline Theme of(const QWidget* widget){
 for(auto* w=widget;w;w=w->parentWidget())if(!w->property("stockTheme").toString().isEmpty())return theme(w->property("stockTheme").toString());
 return theme(widget&&widget->palette().color(QPalette::Window).lightness()>128?"soft":"navy");
}
inline QPalette palette(const Theme&t){
 QPalette p;p.setColor(QPalette::Window,t.bg);p.setColor(QPalette::Base,t.bg);p.setColor(QPalette::AlternateBase,t.panel);
 p.setColor(QPalette::WindowText,t.text);p.setColor(QPalette::Text,t.text);p.setColor(QPalette::ButtonText,t.text);
 p.setColor(QPalette::Button,t.button);p.setColor(QPalette::Highlight,t.selection);p.setColor(QPalette::HighlightedText,t.text);
 p.setColor(QPalette::Mid,t.border);p.setColor(QPalette::Dark,t.border);p.setColor(QPalette::Light,t.panel);
 p.setColor(QPalette::ToolTipBase,t.panel);p.setColor(QPalette::ToolTipText,t.text);p.setColor(QPalette::Link,t.accent);
 for(auto role:{QPalette::Text,QPalette::WindowText,QPalette::ButtonText})p.setColor(QPalette::Disabled,role,t.muted);
 return p;
}
// Optional semantic roles support new plugins. For older view.v1 packages,
// adapt known palette colours only; archived JSON and unknown colours stay intact.
inline QColor plotColor(const Theme& t,QColor original,QString role={}){
 if(!t.preset)return original;
 if(role.isEmpty()){
  const auto c=original.name();
  if(c=="#579fdf"||c=="#579dd9"||c=="#4f87d6"||c=="#4588e5")role="fast";
  else if(c=="#cf993f"||c=="#cf982b"||c=="#ca8c13")role="slow";
  else if(c=="#9bbce4")role="fill";
  else if(c=="#ef717a")role="profit";
  else if(c=="#43b99c")role="loss";
  else if(c=="#91a4bd")role="neutral";
  else if(c=="#a777cf")return t.dark?QColor("#c3a1e5"):QColor("#8053a8");
  else if(c=="#39a696")return t.dark?QColor("#61c9b5"):QColor("#247b6a");
 }
 if(role=="fast"||role=="equity")return t.fast;
 if(role=="slow"||role=="drawdown")return t.slow;
 if(role=="fill")return t.buy;
 if(role=="profit")return t.profit;
 if(role=="loss")return t.loss;
 if(role=="signal"||role=="neutral")return t.muted;
 return original;
}
inline QIcon icon(const QString& kind,const Theme& t){
 QIcon result;
 for(auto mode:{QIcon::Normal,QIcon::Disabled}){
  QPixmap image(48,48);image.setDevicePixelRatio(2);image.fill(Qt::transparent);
  QPainter p(&image);p.setRenderHint(QPainter::Antialiasing);p.setBrush(Qt::NoBrush);
  p.setPen(QPen(mode==QIcon::Disabled?t.muted:t.accent,t.iconStroke,Qt::SolidLine,t.hollowUp?Qt::SquareCap:Qt::RoundCap,t.hollowUp?Qt::MiterJoin:Qt::RoundJoin));
  if(kind=="settings"){
   p.translate(12,12);p.drawEllipse(QPointF(0,0),6,6);p.drawEllipse(QPointF(0,0),2,2);
   for(int i=0;i<8;++i){p.drawLine(QPointF(0,-8),QPointF(0,-10));p.rotate(45);}
  }else if(kind=="run"){p.drawPolygon(QPolygonF{QPointF(7,4),QPointF(20,12),QPointF(7,20)});
  }else if(kind=="close"){p.drawLine(6,6,18,18);p.drawLine(18,6,6,18);
  }else if(kind=="collapse"){p.drawLine(5,16,19,16);p.drawLine(8,10,12,6);p.drawLine(12,6,16,10);
  }else if(kind=="trend"){p.drawPolyline(QPolygonF{QPointF(3,18),QPointF(8,11),QPointF(13,15),QPointF(21,5)});
  }else if(kind=="history"){p.drawEllipse(QRectF(4,4,16,16));p.drawLine(12,7,12,12);p.drawLine(12,12,16,14);
  }else if(kind=="refresh"){p.drawArc(QRectF(4,4,16,16),40*16,285*16);p.drawPolyline(QPolygonF{QPointF(16,3),QPointF(20,5),QPointF(20,9)});
  }else if(kind=="window"){p.drawRoundedRect(QRectF(3,4,18,16),t.hollowUp?0:2,t.hollowUp?0:2);p.drawLine(3,9,21,9);
  }else if(kind=="data"){p.drawEllipse(QRectF(4,3,16,6));p.drawLine(4,6,4,18);p.drawLine(20,6,20,18);p.drawArc(QRectF(4,15,16,6),180*16,180*16);
  }else if(kind=="target"){p.drawEllipse(QRectF(4,4,16,16));p.drawLine(12,1,12,7);p.drawLine(12,17,12,23);p.drawLine(1,12,7,12);p.drawLine(17,12,23,12);
  }else{for(int i=0;i<3;++i){double x=5+i*7,top=5+(i%2)*4;p.drawLine(QPointF(x,2),QPointF(x,22));p.drawRect(QRectF(x-2,top,4,8));}}
  p.end();result.addPixmap(image,mode);
 }
 return result;
}
inline void setIcon(QAbstractButton* button,QString role){
 const auto t=of(button);
 if(button->property("appearanceIcon")==role&&button->property("appearanceIconTheme")==t.id)return;
 button->setProperty("appearanceIcon",role);button->setProperty("appearanceIconTheme",t.id);button->setIcon(icon(role,t));button->setIconSize(QSize(18,18));
}
inline void refreshIcons(QWidget* root){
 for(auto* b:root->findChildren<QAbstractButton*>()){
  auto role=b->property("appearanceIcon").toString();const auto id=b->objectName();
  if(id=="workbenchSettings")role="settings";
  else if(id=="overlay")role="trend";
  else if(id=="nine")role="target";
  else if(id=="parameters")role="settings";
  else if(id=="latest")role="target";
  else if(id=="openChart"||id=="dualCharts")role="window";
  else if(id=="refreshLive"||id=="extensionRefreshMarket")role="refresh";
  else if(id.startsWith("extensionAction_"))role="strategy";
  if(!role.isEmpty())setIcon(b,role);
 }
}
}
