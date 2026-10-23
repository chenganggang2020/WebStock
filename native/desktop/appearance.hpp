#pragma once
#include <QColor>
#include <QPalette>
#include <QStringList>

namespace appearance {
struct Theme {QString id,name;bool dark;QColor bg,panel,text,muted,border,accent,up,down,selection,button;};
inline QStringList ids(){return {"navy","graphite","soft","warm"};}
inline Theme theme(QString id){
 if(id=="graphite")return {id,"石墨灰",true,"#181a1f","#252830","#edf0f5","#b1bac8","#657084","#9cbcff","#ff4040","#00d060","#303c52","#30353f"};
 if(id=="soft")return {id,"柔白蓝",false,"#f8fafc","#e9eef5","#1e2a3b","#526178","#7f8c9f","#175ea8","#ce2438","#00804a","#d6e7fb","#f0f4f9"};
 if(id=="warm")return {id,"暖米色",false,"#f7f3eb","#eae3d7","#302c27","#645b50","#8b7d69","#875611","#c92536","#007c46","#e9d9b8","#f1e9dc"};
 return {"navy","深海蓝",true,"#101722","#1c2838","#e6edf5","#a5b4c7","#51647c","#6eb6ff","#ff4040","#00d060","#20364d","#26364b"};
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
}
