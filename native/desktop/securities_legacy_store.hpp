#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QString>
// Read-only functional conversion store. Construction does not create/open files.
class SecuritiesLegacyStore final {
 QString path;
public:
 struct Snapshot { QJsonObject meta; QJsonArray directory,profiles; };
 explicit SecuritiesLegacyStore(QString path);
 // All three views share one read transaction and the original full validation.
 Snapshot snapshot()const;
 QJsonArray directory()const;
 QJsonArray profiles()const;
 QJsonObject profile(QString nativeId)const;
 QJsonObject stats()const;
 QString filePath()const;
};
