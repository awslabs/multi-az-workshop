namespace BAMCIS.MultiAZApp.Utilities
{
    public interface IEnvironmentProvider
    {
        IEnvironment ResolveEnvironment();
    }
}