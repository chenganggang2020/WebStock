#pragma once
#include <QJsonObject>
#include <QJsonArray>
#include <QLockFile>
#include <QObject>
#include <QProcess>
#include <QTimer>
#include <functional>
#include <memory>

namespace quantPlugin {
QByteArray generatedData(const QJsonObject& artifact);
QByteArray tableCsv(const QJsonObject& table);
QByteArray read(const QString& path, qint64 limit = 32*1024*1024);
QJsonObject object(const QByteArray& data);
QString hash(const QByteArray& data);
void write(const QString& path, const QByteArray& data);
void write(const QString& path, const QJsonObject& data);
void require(bool condition, const QString& message);
QJsonObject validateManifest(const QJsonObject& manifest);
QJsonObject validateParameters(const QJsonObject& operation, const QJsonObject& parameters);

class Repository {
    QString root_;
public:
    explicit Repository(QString root);
    QString root() const { return root_; }
    QJsonArray plugins() const;
    QJsonObject plugin(const QString& id) const;
    QString directory(const QJsonObject& plugin) const;
    QJsonObject install(const QByteArray& package);
    QString runtimeFor(const QString& id) const;
    void configure(const QString& id, const QString& runtimePath, bool enabled);
    void rememberParameters(const QString& id, const QString& operationId, const QJsonObject& parameters);
    void uninstall(const QString& id);
};

class Job : public QObject {
    Repository repository_;
    QProcess process_;
    QTimer timeout_;
    std::unique_ptr<QLockFile> lock_;
    QJsonObject record_;
    QByteArray stdout_, stderr_;
    QString folder_, stopped_;
    bool finishing_ = false;
    void* processGroup_ = nullptr;
    void save();
    void drain();
    void finish(int exitCode, QProcess::ExitStatus status);
    void stop(const QString& reason);
    QJsonObject verify(const QString& directory, const QJsonObject& record) const;
public:
    std::function<void()> changed;
    std::function<void(QString)> progress;
    explicit Job(QString root, QObject* parent = nullptr);
    ~Job() override;
    bool active() const { return bool(lock_); }
    QJsonObject current() const { return record_; }
    QJsonArray records() const;
    QJsonArray savedMarketData() const;
    QJsonObject marketDataInput(const QString& id) const;
    void reuseArchivedMarketData() const;
    QJsonObject reopen(const QString& id) const;
    QByteArray exportResult(const QString& id) const;
    QString importResult(const QByteArray& bundle);
    void start(const QString& pluginId, const QString& operationId, const QString& inputCsv,
               const QJsonObject& parameters, const QJsonObject& inputPolicy, int timeoutSeconds = 600);
    void cancel();
};
}
