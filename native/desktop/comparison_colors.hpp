#pragma once
#include <QColor>
#include <QCryptographicHash>
#include <QIcon>
#include <QPixmap>
#include <QStringList>
namespace marketComparison {
// Identity, not selection order: adding/removing another line never recolors it.
inline QColor seriesColor(const QString& key){
 const QStringList keys{"index:sse","index:szse","index:chinext","index:star50","index:csi300","index:csi500","index:csi1000","index:sse50","sector-index:bank"};
 const QStringList colors{"#ff5252","#42baff","#00ce84","#b28aff","#ffc247","#26d7d7","#f49748","#ed77c7","#ced95b"};
 const int index=keys.indexOf(key);if(index>=0)return QColor(colors[index]);
 auto digest=QCryptographicHash::hash(key.toUtf8(),QCryptographicHash::Sha256);const auto hue=(quint8(digest[0])*256+quint8(digest[1]))%360;
 return QColor::fromHsv(hue,155+quint8(digest[2])%65,225+quint8(digest[3])%30);
}
inline QIcon seriesIcon(const QString& key){QPixmap square(12,12);square.fill(seriesColor(key));return QIcon(square);}
}
