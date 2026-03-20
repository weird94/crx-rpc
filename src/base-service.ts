import type { ServiceProxy } from './client'
import type { Identifier } from './id'

export interface BaseServiceCreateOptions {
  tabId?: number
  targetId?: string | number
}

export interface ServiceAccessor {
  createRPCService<T>(serviceIdentifier: Identifier<T>, options?: BaseServiceCreateOptions): ServiceProxy<T>
}

export class BaseService {
  private serviceAccessor?: ServiceAccessor

  setServiceAccessor(serviceAccessor: ServiceAccessor): void {
    this.serviceAccessor = serviceAccessor
  }

  protected getService<T>(
    serviceIdentifier: Identifier<T>,
    options?: BaseServiceCreateOptions
  ): ServiceProxy<T> {
    if (!this.serviceAccessor) {
      throw new Error('Service accessor is not available. Register the service on a host first.')
    }

    return this.serviceAccessor.createRPCService(serviceIdentifier, options)
  }
}

export function attachServiceAccessor(service: unknown, serviceAccessor: ServiceAccessor): void {
  if (service instanceof BaseService) {
    service.setServiceAccessor(serviceAccessor)
  }
}
