#pragma once
#include <QtCore>
namespace paperAutomation {
QString openingHash(const QJsonObject& input);
QString executionHash(const QJsonObject& book);
QJsonObject seed(const QJsonObject& input,const QJsonObject& settings,const QString& now);
QJsonObject configure(QJsonObject book,const QJsonObject& settings,const QString& now);
QJsonObject cancel(QJsonObject book,const QString& now,const QString& reason);
QJsonObject executionInput(const QJsonObject& book,QJsonObject current,const QString& now);
QJsonObject prepareTask(QJsonObject book,const QJsonObject& current,const QString& now,const QString& slot);
QJsonObject claim(QJsonObject book,const QString& taskId,const QString& preparationId,const QString& now);
QJsonObject fail(QJsonObject book,const QString& taskId,const QString& now,const QString& reason,bool retryable);
QJsonObject accept(QJsonObject book,const QJsonObject& current,const QString& taskId,const QString& raw,const QString& now,const QJsonObject& provenance);
QJsonObject schedule(QJsonObject book,const QJsonObject& current,const QString& now);
QJsonObject execute(QJsonObject book,const QJsonObject& current,const QJsonObject& markets,const QString& now);
}
