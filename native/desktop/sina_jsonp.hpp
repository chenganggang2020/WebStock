#pragma once
#include <QString>
#include <QRegularExpression>
// The provider prepends a block-comment notice. It is data, never executable JS.
// Strip only bounded leading comments; still bind the exact JSONP identifier.
namespace sinaJsonp {
inline QString array(QString text,const QString& symbol){
 text=text.trimmed();int removed=0;
 while(text.startsWith("/*")){int end=text.indexOf("*/",2);if(end<0||removed+end+2>4096)return {};removed+=end+2;text=text.mid(end+2).trimmed();}
 auto match=QRegularExpression("^var\\s+_"+QRegularExpression::escape(symbol)+"\\s*=\\s*\\((\\[.*\\])\\);?\\s*$",QRegularExpression::DotMatchesEverythingOption).match(text);
 return match.hasMatch()?match.captured(1):QString{};
}
}
