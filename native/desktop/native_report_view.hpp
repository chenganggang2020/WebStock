#pragma once
#include <QWidget>
#include <QUrl>
#include <memory>

// Dedicated offline report surface. Separate from external source/login pages.
class NativeReportView : public QWidget {
    Q_OBJECT
    struct State;
    std::unique_ptr<State> state_;
    void initialize();
    void attach(void* controller);
    void syncBounds();
    void inspectRenderedDocument();
public:
    NativeReportView(QByteArray html, QString profile, QWidget* parent=nullptr);
    ~NativeReportView() override;
    static QUrl reportUrl();
    static bool allowedNavigation(const QUrl& url);
signals:
    void loaded();
    void rendered(int canvases);
    void failure(QString message);
protected:
    void showEvent(QShowEvent*) override;
    void hideEvent(QHideEvent*) override;
    void resizeEvent(QResizeEvent*) override;
};
