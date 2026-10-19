#pragma once
#include <QJsonObject>
#include <QString>
namespace accountEdit {
void check(const QJsonObject& expected,const QJsonObject& current);
QJsonObject draft(const QJsonObject& account);
QJsonObject propose(const QJsonObject& expected,const QJsonObject& draft);
}
