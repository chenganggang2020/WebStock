#pragma once
#include <QtWidgets>
#include <algorithm>
#include <functional>
#include <exception>

// Normal startup and acceptance tools use this same readiness phase. Qt 6.9.1
// documents QFontDatabase as thread safe. No widget is accessed by the worker.
namespace nativeFontPreparation {
struct Result {
    bool ready = false, canceled = false;
    QString error;
    int families = 0, batches = 0;
    double totalMs = 0, workerMs = 0, maximumFamilyMs = 0, maximumBatchMs = 0;
};
inline Result prepare() {
    Q_ASSERT(qApp && QThread::currentThread() == qApp->thread());
    struct Startup final : QWidget {
        std::function<void()> cancel;
        bool finished = false;
        void closeEvent(QCloseEvent* e) override {
            if (finished) { e->accept(); return; }
            if (cancel) cancel();
            e->ignore();
        }
    };
    Result result;
    QElapsedTimer total; total.start();
    Startup startup;
    startup.setObjectName("stockFontPreparation"); startup.setWindowTitle("Stock");
    auto* layout = new QVBoxLayout(&startup);
    auto* label = new QLabel("正在准备文字显示…", &startup);
    label->setTextFormat(Qt::PlainText); label->setWordWrap(true);
    auto* progress = new QProgressBar(&startup); progress->setRange(0, 0);
    auto* cancel = new QPushButton("取消启动", &startup);
    cancel->setObjectName("stockFontPreparationCancel");
    layout->addWidget(label); layout->addWidget(progress); layout->addWidget(cancel);
    startup.resize(400, 140);
    QSemaphore checkpoint;
    bool enumerationCompleted = false;
    QEventLoop loop;
    auto* worker = QThread::create([&] {
        QElapsedTimer elapsed; elapsed.start();
        try {
            const auto families = QFontDatabase::families();
            QElapsedTimer batch; batch.start(); int inBatch = 0;
            for (const auto& family : families) {
                if (QThread::currentThread()->isInterruptionRequested()) break;
                QElapsedTimer one; one.start(); QFontDatabase::styles(family);
                result.maximumFamilyMs = std::max(result.maximumFamilyMs, one.nsecsElapsed() / 1e6);
                ++result.families; ++inBatch;
                if (inBatch >= 8 || batch.nsecsElapsed() >= 8'000'000) {
                    result.maximumBatchMs = std::max(result.maximumBatchMs, batch.nsecsElapsed() / 1e6);
                    ++result.batches;
                    const int completed = result.families, count = families.size();
                    QMetaObject::invokeMethod(&startup, [&, completed, count] {
                        if (!result.canceled) {
                            progress->setRange(0, count); progress->setValue(completed);
                            label->setText(QString("正在准备文字显示… %1/%2").arg(completed).arg(count));
                            // Complete GUI font queries while the worker has released Qt's
                            // global font lock, before permitting its next bounded batch.
                            startup.repaint();
                        }
                        checkpoint.release();
                    }, Qt::QueuedConnection);
                    while (!checkpoint.tryAcquire(1, 25) &&
                           !QThread::currentThread()->isInterruptionRequested()) {}
                    inBatch = 0; batch.restart();
                }
            }
            enumerationCompleted = !QThread::currentThread()->isInterruptionRequested();
        } catch (const std::exception& e) {
            result.error = QString::fromUtf8(e.what());
        }
        result.workerMs = elapsed.nsecsElapsed() / 1e6;
    });
    worker->setParent(&startup); worker->setObjectName("stockFontMetadataWorker");
    startup.cancel = [&] {
        result.canceled = true;
        cancel->setEnabled(false); label->setText("正在取消启动…");
        worker->requestInterruption(); checkpoint.release();
    };
    QObject::connect(cancel, &QPushButton::clicked, &startup, startup.cancel);
    QTimer completion(&startup); completion.setObjectName("stockFontPreparationCompletion");
    completion.setInterval(5);
    QObject::connect(&completion, &QTimer::timeout, &startup, [&] {
        // Nonblocking wait also waits for thread-local cleanup on Windows. Never
        // delete a still-running QThread or return before QApplication can safely exit.
        if (!worker->wait(0)) return;
        completion.stop(); startup.finished = true; startup.hide(); loop.quit();
    });
    startup.show(); completion.start(); worker->start();
    loop.exec();
    // An external application exit can beat completion even after the worker has
    // exited. Only our completion callback authorizes constructing the main window.
    if (!startup.finished) startup.cancel();
    while (!worker->wait(0)) QCoreApplication::processEvents(QEventLoop::ExcludeUserInputEvents, 5);
    delete worker;
    result.ready = enumerationCompleted && !result.canceled && result.error.isEmpty();
    if (!result.ready && !result.canceled && result.error.isEmpty()) result.error = "字体准备未完成";
    result.totalMs = total.nsecsElapsed() / 1e6;
    return result;
}
}
