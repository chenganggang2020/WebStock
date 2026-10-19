#pragma once
#include <QWidget>
#include <QJsonObject>
#include <functional>
using MigrationStatusSnapshot=std::function<QJsonObject()>;
using MigrationStatusAvailable=std::function<bool(const QString&,const QString&)>;
using MigrationStatusOpen=std::function<void(const QString&,const QString&)>;
using MigrationStatusEvidence=std::function<QJsonObject(const QString&,const QString&)>;
QWidget* migrationStatusPage(QWidget* parent=nullptr,MigrationStatusSnapshot={},MigrationStatusAvailable={},MigrationStatusOpen={},MigrationStatusEvidence={});
bool migrationStatusBack(QWidget*);
QJsonObject migrationStatusSaveState(QWidget*);
void migrationStatusRestoreState(QWidget*,const QJsonObject&);
