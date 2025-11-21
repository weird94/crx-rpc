export class Disposable {
  private _isDisposed = false
  private _disposeCallbacks: Set<() => void> = new Set()

  dispose(): void {
    if (this._isDisposed) return
    this._isDisposed = true
    this._disposeCallbacks.forEach(callback => callback())
  }

  isDisposed(): boolean {
    return this._isDisposed
  }

  protected disposeWithMe(disposeLike: () => void) {
    this._disposeCallbacks.add(disposeLike)
  }
}
