#pragma once
#include <QString>
#include <QRegularExpression>
inline QString groupDisplayName(QString name,const QString& id){
 if(!id.startsWith("local:ths:"))return name;
 name.remove(QRegularExpression("^同花顺\\s*[·:：]?\\s*"));
 name.replace(QRegularExpression("_+")," ");
 name=name.simplified();
 return name=="全部自选"?QString("导入自选"):name;
}
