// @see https://github.com/padenot/ringbuf.js/blob/main/js/ringbuf.js

type TypedArrayConstructor =
  | Float32ArrayConstructor
  | Int32ArrayConstructor
  | Uint8ArrayConstructor
  | Uint16ArrayConstructor
  | Uint32ArrayConstructor
  | Int8ArrayConstructor
  | Int16ArrayConstructor
  | Int32ArrayConstructor
  | Uint8ClampedArrayConstructor;

type TypedArray =
  | Float32Array
  | Int32Array
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Uint8ClampedArray;

declare module "ringbuf.js" {
  export class RingBuffer {
    /** Allocate the SharedArrayBuffer for a RingBuffer, based on the type and
     * capacity required
     * @param {number} capacity The number of elements the ring buffer will be
     * able to hold.
     * @param {TypedArrayConstructor} type A typed array constructor, the type that this ring
     * buffer will hold.
     * @return {SharedArrayBuffer} A SharedArrayBuffer of the right size.
     * @static
     */
    static getStorageForCapacity(
      capacity: number,
      type: TypedArrayConstructor
    ): SharedArrayBuffer;

    /**
     * @constructor
     * @param {SharedArrayBuffer} sab A SharedArrayBuffer obtained by calling
     * {@link RingBuffer.getStorageFromCapacity}.
     * @param {TypedArrayConstructor} type A typed array constructor, the type that this ring
     * buffer will hold.
     */
    constructor(sab: SharedArrayBuffer, type: TypedArrayConstructor) {}

    buf: SharedArrayBuffer;

    /**
     * Push elements to the ring buffer.
     * @param {TypedArray} elements A typed array of the same type as passed in the ctor, to be written to the queue.
     * @param {Number} length If passed, the maximum number of elements to push.
     * If not passed, all elements in the input array are pushed.
     * @param {Number} offset If passed, a starting index in elements from which
     * the elements are read. If not passed, elements are read from index 0.
     * @return the number of elements written to the queue.
     */
    push(elements: TypedArray, length: number, offset?: number): number;

    /**
     * Write bytes to the ring buffer using callbacks. This create wrapper
     * objects and can GC, so it's best to no use this variant from a real-time
     * thread such as an AudioWorklerProcessor `process` method.
     * The callback is passed two typed arrays of the same type, to be filled.
     * This allows skipping copies if the API that produces the data writes is
     * passed arrays to write to, such as `AudioData.copyTo`.
     * @param {number} amount The maximum number of elements to write to the ring
     * buffer. If amount is more than the number of slots available for writing,
     * then the number of slots available for writing will be made available: no
     * overwriting of elements can happen.
     * @param {Function} cb A callback with two parameters, that are two typed
     * array of the correct type, in which the data need to be copied. If the
     * callback doesn't return anything, it is assumed all the elements
     * have been written to. Otherwise, it is assumed that the returned number is
     * the number of elements that have been written to, and those elements have
     * been written started at the beginning of the requested buffer space.
     *
     * @return The number of elements written to the queue.
     */
    writeCallback(
      amount: number,
      cb: (first: TypedArray, second: TypedArray) => void
    ): number;

    /**
     * Write bytes to the ring buffer using a callback.
     *
     * This allows skipping copies if the API that produces the data writes is
     * passed arrays to write to, such as `AudioData.copyTo`.
     *
     * @param {number} amount The maximum number of elements to write to the ring
     * buffer. If amount is more than the number of slots available for writing,
     * then the number of slots available for writing will be made available: no
     * overwriting of elements can happen.
     * @param {Function} cb A callback with five parameters:
     *
     * (1) The internal storage of the ring buffer as a typed array
     * (2) An offset to start writing from
     * (3) A number of elements to write at this offset
     * (4) Another offset to start writing from
     * (5) A number of elements to write at this second offset
     *
     * If the callback doesn't return anything, it is assumed all the elements
     * have been written to. Otherwise, it is assumed that the returned number is
     * the number of elements that have been written to, and those elements have
     * been written started at the beginning of the requested buffer space.
     * @return The number of elements written to the queue.
     */
    writeCallbackWithOffset(
      amount: number,
      cb: (first: TypedArray, second: TypedArray) => number
    ): number;

    /**
     * Read up to `elements.length` elements from the ring buffer. `elements` is a typed
     * array of the same type as passed in the ctor.
     * Returns the number of elements read from the queue, they are placed at the
     * beginning of the array passed as parameter.
     * @param {TypedArray} elements An array in which the elements read from the
     * queue will be written, starting at the beginning of the array.
     * @param {Number} length If passed, the maximum number of elements to pop. If
     * not passed, up to elements.length are popped.
     * @param {Number} offset If passed, an index in elements in which the data is
     * written to. `elements.length - offset` must be greater or equal to
     * `length`.
     * @return The number of elements read from the queue.
     */
    pop(elements: TypedArray, length: number, offset?: number): number;

    /**
     * @return True if the ring buffer is empty false otherwise. This can be late
     * on the reader side: it can return true even if something has just been
     * pushed.
     */
    empty(): boolean;

    /**
     * @return True if the ring buffer is full, false otherwise. This can be late
     * on the write side: it can return true when something has just been popped.
     */
    full(): boolean;

    /**
     * @return The usable capacity for the ring buffer: the number of elements
     * that can be stored.
     */
    capacity(): number;

    /**
     * @return The number of elements available for reading. This can be late, and
     * report less elements that is actually in the queue, when something has just
     * been enqueued.
     */
    availableRead(): number;

    /**
     * Compatibility alias for availableRead().
     *
     * @return The number of elements available for reading. This can be late, and
     * report less elements that is actually in the queue, when something has just
     * been enqueued.
     *
     * @deprecated
     */
    available_read(): number;

    /**
     * @return The number of elements available for writing. This can be late, and
     * report less elements that is actually available for writing, when something
     * has just been dequeued.
     */
    availableWrite(): number;

    /**
     * Compatibility alias for availableWrite.
     *
     * @return The number of elements available for writing. This can be late, and
     * report less elements that is actually available for writing, when something
     * has just been dequeued.
     *
     * @deprecated
     */
    available_write(): number;

    /**
     * @return the type of the underlying ArrayBuffer for this RingBuffer. This
     * allows implementing crude type checking.
     */
    type(): string;
  }
}
