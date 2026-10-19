#pragma once
#include "material_library_model.hpp"
class MaterialLibraryStore {
QString file;
public:
explicit MaterialLibraryStore(const QString&,bool deferred=false);
static QJsonObject readOnlySnapshot(const QString&);
QJsonObject heads() const;
QJsonArray history() const;
void save(const QJsonObject&,const QString& expectedHead);
QJsonObject preview(const QByteArray&) const;
void merge(const QJsonObject&);
QByteArray backup() const;
QJsonObject state() const;
QString saveState(const QJsonObject&,const QString& expected);
};
